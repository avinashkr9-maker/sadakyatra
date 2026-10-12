import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

async function launch(useCamera) {
  const permission = useCamera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Permission needed', useCamera ? 'Allow camera access to take the photo.' : 'Allow photo access to choose the picture.');
    return null;
  }
  // Compressed so a document photo stays well under the 5 MB upload limit.
  const options = { mediaTypes: ['images'], quality: 0.5, base64: true };
  const result = useCamera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.[0]?.base64) return null;
  const asset = result.assets[0];
  return { data: asset.base64, contentType: asset.mimeType || 'image/jpeg', uri: asset.uri };
}

// Asks "Camera or Gallery?" and resolves to { data, contentType, uri }, or null if cancelled.
export function pickPhoto(title) {
  return new Promise((resolve) => {
    Alert.alert(title, 'Take a photo or choose one from your gallery.', [
      { text: 'Camera', onPress: () => launch(true).then(resolve, () => resolve(null)) },
      { text: 'Gallery', onPress: () => launch(false).then(resolve, () => resolve(null)) },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) }
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}
