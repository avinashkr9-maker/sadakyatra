# SadakYatra Android App (MVP)

This is an Expo React Native app focused on Android first.

## Run
1. `cd app`
2. `npm install`
3. `npm start`
4. Press `a` to run Android emulator (or open in Expo Go)

## Backend connection
- App API base URL is configured in `app/src/api/client.js`.
- The app also lets you change the backend URL from the Home screen API Settings panel.
- Keep backend running: `cd ../backend && npm run dev`.

## Login
- Tap Login in the top right header to authenticate with your phone number.
- The app uses the backend `POST /auth/mock-login` endpoint and stores a session token for the current run.

## Current features
- Backend health test button
- Fare estimation
- Booking creation

## Next
- OTP login screen
- Booking history screen
- Driver tracking status timeline
