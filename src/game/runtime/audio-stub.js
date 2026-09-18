/* 音频引擎的空实现。
 *
 * 上游 script/audio.js（Web Audio API 播放器）不随本移植分发 —— 本移植为静音版。
 * 但它被 10 个模块调用约 150 处（AudioEngine.playSound / playBackgroundMusic …），
 * 且 script/events/*.js 大量以 `audio: AudioLibrary.EVENT_XXX` 传递音频引用。
 * 因此这里提供一个 API 表面完全对齐的空实现，让那些调用点原样工作，
 * 同时不产生任何网络请求、不加载任何 flac、不创建 AudioContext。
 *
 * script/audioLibrary.js（常量表，内容是 'audio/xxx.flac' 路径字符串）仍然保留，
 * 因为事件模块引用了它的字段；那些字符串在本实现下永远不会被访问。 */

function __audioNoop() {}

var AudioEngine = {
  FADE_TIME: 1,
  AUDIO_BUFFER_CACHE: {},
  _audioContext: null,
  _master: null,
  _currentBackgroundMusic: null,
  _currentEventAudio: null,
  _currentSoundEffectAudio: null,
  _initialized: false,

  init: __audioNoop,
  _preloadAudio: __audioNoop,
  _initAudioContext: __audioNoop,
  _createMasterChannel: __audioNoop,
  _getMissingAudioBuffer: __audioNoop,
  _playSound: __audioNoop,
  _playBackgroundMusic: __audioNoop,
  _playEventMusic: __audioNoop,
  _stopEventMusic: __audioNoop,

  playBackgroundMusic: __audioNoop,
  playEventMusic: __audioNoop,
  stopEventMusic: __audioNoop,
  playSound: __audioNoop,
  loadAudioFile: __audioNoop,
  setBackgroundMusicVolume: __audioNoop,
  setMasterVolume: __audioNoop,
  tryResumingAudioContext: __audioNoop,

  /* engine.js 在 init 末尾会写：
   *     if (!AudioEngine.isAudioContextRunning()) {
   *       document.addEventListener('click', Engine.resumeAudioContext, true);
   *     }
   * 恒返回 true 即可让这段短路，避免给整个 Obsidian 文档挂上 click 监听。 */
  isAudioContextRunning: function () {
    return true;
  }
};
