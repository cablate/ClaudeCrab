declare module 'sound-play' {
  interface SoundPlay {
    play(filePath: string, volume?: number): Promise<void>;
  }
  const soundPlay: SoundPlay;
  export default soundPlay;
}
