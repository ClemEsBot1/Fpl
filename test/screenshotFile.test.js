import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mightBeImage } from '../src/lib/imageFile.js';

test('files saved from apps without an image type are still tried', () => {
  assert.ok(mightBeImage({ type: 'image/jpeg', name: 'shot.jpg' }));
  assert.ok(mightBeImage({ type: '', name: 'image' }), 'no type, no extension (some Reddit saves)');
  assert.ok(mightBeImage({ type: 'application/octet-stream', name: 'download' }));
  assert.ok(mightBeImage({ type: 'text/plain', name: 'photo.webp' }), 'extension wins over a wrong type');
  assert.ok(mightBeImage({ type: '', name: 'IMG_0001.HEIC' }));
  assert.ok(!mightBeImage({ type: 'application/pdf', name: 'team.pdf' }));
  assert.ok(!mightBeImage({ type: 'video/mp4', name: 'clip.mp4' }));
});
