-- =====================================================================
-- FIX: "invalid input syntax for type numeric" (khaali Discount/Advance/Toll)
-- Supabase → SQL Editor → New query → ye file paste → Run. Bas.
-- =====================================================================

-- Text ko number mein safely badlo: khaali / galat value → NULL (error nahi)
create or replace function public.web_num(t text)
returns numeric language sql immutable as $$
  select case when t ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then trim(t)::numeric else null end;
$$;

-- 4) Naya bill — number, fare aur total sab SERVER pe calculate hote hain (driver badal nahi sakta)
create or replace function public.web_create_invoice(p jsonb)
returns public.web_invoices
language plpgsql security definer set search_path = public as $$
declare
  v_is_admin boolean := public.web_is_admin();
  v_driver public.web_drivers;
  v_year int := extract(year from (now() at time zone 'Asia/Kolkata'))::int;
  v_seq int;
  v_prefix text;
  v_rate_sedan numeric; v_rate_suv numeric; v_rate_tempo numeric; v_mult numeric; v_min numeric; v_local_sedan numeric; v_local_suv numeric;
  v_trip text := coalesce(p->>'trip_type', 'outstation');
  v_vehicle text := coalesce(p->>'vehicle', 'sedan');
  v_round boolean := coalesce(p->>'round_trip', '') in ('true', 't', '1', 'yes', 'on');
  v_km int; v_calc numeric; v_base numeric; v_extras jsonb := '[]'::jsonb; v_extras_total numeric := 0;
  v_discount numeric := greatest(coalesce(public.web_num(p->>'discount'), 0), 0);
  v_advance numeric := greatest(coalesce(public.web_num(p->>'advance'), 0), 0);
  v_gstin text; v_gst_rate numeric := 0; v_sub numeric; v_gst numeric; v_total numeric;
  v_row public.web_invoices;
  e jsonb;
begin
  select * into v_driver from public.web_drivers where user_id = auth.uid() and active;
  if not v_is_admin and v_driver.user_id is null then
    raise exception 'Not allowed: only active drivers or admins can create bills';
  end if;
  if coalesce(trim(p->>'customer_name'), '') = '' then raise exception 'Customer name is required'; end if;

  select value into v_rate_sedan from web_fare_rates where key = 'sedanPerKm';
  select value into v_rate_suv   from web_fare_rates where key = 'suvPerKm';
  select value into v_rate_tempo from web_fare_rates where key = 'tempoPerKm';
  select value into v_mult       from web_fare_rates where key = 'roundTripMultiplier';
  select value into v_min        from web_fare_rates where key = 'minimumFare';
  select value into v_local_sedan from web_fare_rates where key = 'localSedanFare';
  select value into v_local_suv   from web_fare_rates where key = 'localSuvFare';

  -- Calculated fare (reference) — admin ke rates se
  if v_trip = 'outstation' then
    select distance_km into v_km from web_fare_routes
      where from_city = p->>'from_city' and to_city = p->>'to_city' limit 1;
    if v_km is null then v_km := nullif(round(coalesce(public.web_num(p->>'distance_km'), 0))::int, 0); end if;
    if v_km is not null then
      v_calc := v_km * case v_vehicle when 'suv' then coalesce(v_rate_suv, 0) when 'tempo' then coalesce(v_rate_tempo, 0) else coalesce(v_rate_sedan, 0) end;
      if v_round then v_calc := v_calc * coalesce(v_mult, 1); end if;
      v_calc := greatest(round(v_calc / 10) * 10, coalesce(v_min, 0));
    end if;
  elsif v_trip = 'local' then
    v_calc := case v_vehicle when 'suv' then v_local_suv when 'sedan' then v_local_sedan else null end;
  end if;

  v_base := coalesce(public.web_num(p->>'base_fare'), v_calc);
  if v_base is null or v_base < 0 then raise exception 'Fare is required'; end if;

  for e in select * from jsonb_array_elements(coalesce(p->'extras', '[]'::jsonb)) loop
    if coalesce(public.web_num(e->>'amount'), 0) > 0 then
      v_extras := v_extras || jsonb_build_array(jsonb_build_object('label', left(coalesce(e->>'label', 'Extra'), 40), 'amount', public.web_num(e->>'amount')));
      v_extras_total := v_extras_total + public.web_num(e->>'amount');
    end if;
  end loop;

  v_sub := greatest(v_base + v_extras_total - v_discount, 0);
  select value into v_gstin from web_settings where key = 'gstin';
  if coalesce(trim(v_gstin), '') <> '' then
    select coalesce(public.web_num(value), 0) into v_gst_rate from web_settings where key = 'gst_rate';
  end if;
  v_gst := round(v_sub * v_gst_rate / 100, 2);
  v_total := round(v_sub + v_gst);

  -- Invoice number: saal ke hisaab se series, kabhi duplicate nahi
  perform pg_advisory_xact_lock(778800 + v_year);
  select coalesce(max(inv_seq), 0) + 1 into v_seq from web_invoices where inv_year = v_year;
  select coalesce(nullif(trim(value), ''), 'SY') into v_prefix from web_settings where key = 'invoice_prefix';

  insert into web_invoices (
    invoice_no, inv_year, inv_seq, driver_id, driver_name, customer_name, customer_phone, trip_type,
    from_city, to_city, distance_km, round_trip, vehicle, trip_date, calculated_fare, base_fare,
    extras, extras_total, discount, subtotal, gst_rate, gst_amount, total, advance, balance, notes
  ) values (
    v_prefix || '-' || v_year || '-' || lpad(v_seq::text, 4, '0'), v_year, v_seq, auth.uid(),
    coalesce(v_driver.name, 'Owner'), trim(p->>'customer_name'), coalesce(trim(p->>'customer_phone'), ''), v_trip,
    nullif(p->>'from_city', ''), nullif(p->>'to_city', ''), v_km, v_round, v_vehicle,
    case when coalesce(p->>'trip_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p->>'trip_date')::date else (now() at time zone 'Asia/Kolkata')::date end, v_calc, v_base,
    v_extras, v_extras_total, v_discount, v_sub, v_gst_rate, v_gst, v_total, least(v_advance, v_total),
    v_total - least(v_advance, v_total), left(coalesce(p->>'notes', ''), 300)
  ) returning * into v_row;
  if v_row.balance = 0 then
    update web_invoices set status = 'paid', paid_at = now() where id = v_row.id returning * into v_row;
  end if;
  return v_row;
end;
$$;

