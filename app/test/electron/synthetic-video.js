'use strict';

// A real WebM, painted and recorded inside the page, then handed to the drop
// handler as a File — which is what the operating system delivers when somebody
// drags one in.
//
// Shared by the import end-to-end test and the screenshot tool so both exercise
// the same video. The screenshot tool needs it because the recording route is
// not always open: macOS hands back nothing at all until Screen Recording has
// been granted, and importing reaches framing, processing and Done without ever
// asking to read the screen.
//
// Returned as source to evaluate in the renderer rather than run here, because
// MediaRecorder and canvas.captureStream only exist there.
function makeAndDropVideo(options) {
  const settings = options || {};
  const ms = settings.ms || 4000;
  const name = settings.name || 'holiday-demo.webm';

  return `(async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext('2d');

  let scene = 0;
  const draw = () => {
    context.fillStyle = ['#123', '#231', '#312'][scene % 3];
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#fff';
    context.font = 'bold 120px sans-serif';
    context.fillText('scene ' + scene, 200, 380);
  };
  draw();
  const painter = setInterval(() => { scene += 1; draw(); }, 700);

  const audio = new AudioContext();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  gain.gain.value = 0.063;
  oscillator.frequency.value = 220;
  const destination = audio.createMediaStreamDestination();
  oscillator.connect(gain).connect(destination);
  oscillator.start();

  const stream = new MediaStream([
    canvas.captureStream(30).getVideoTracks()[0],
    destination.stream.getAudioTracks()[0]
  ]);

  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find((type) => MediaRecorder.isTypeSupported(type));

  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4e6 });
  recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };

  await new Promise((resolve) => {
    recorder.onstop = resolve;
    recorder.start(500);
    setTimeout(() => recorder.stop(), ${ms});
  });

  clearInterval(painter);
  oscillator.stop();
  audio.close();
  stream.getTracks().forEach((track) => track.stop());

  const blob = new Blob(chunks, { type: 'video/webm' });
  const file = new File([blob], ${JSON.stringify(name)}, { type: 'video/webm' });

  const transfer = new DataTransfer();
  transfer.items.add(file);
  document.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));

  return blob.size;
})()`;
}

module.exports = { makeAndDropVideo };
