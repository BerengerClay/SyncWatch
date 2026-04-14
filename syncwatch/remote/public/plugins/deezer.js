class DeezerPlugin extends BaseSyncPlugin {
  constructor() {
    super();
    this.name = 'Deezer';
  }

  // On dit au moteur : "Ne cherche plus de balise, utilise dzPlayer"
  getBaseState() {
    if (!window.dzPlayer) return null;
    return {
      time: window.dzPlayer.getPosition(),
      paused: !window.dzPlayer.isPlaying(),
      duration: window.dzPlayer.getDuration()
    };
  }

  applyBaseState(mediaState) {
    if (!window.dzPlayer) return;
    
    // Si décalage > 2s, on force le temps
    if (Math.abs(window.dzPlayer.getPosition() - mediaState.time) > 2) {
      // Attention: sur l'API Deezer, le seek se fait parfois en % (0 à 1)
      window.dzPlayer.control.seek(mediaState.time / window.dzPlayer.getDuration()); 
    }
    
    if (!window.dzPlayer.isPlaying() && !mediaState.paused) {
        window.dzPlayer.control.play();
    } else if (window.dzPlayer.isPlaying() && mediaState.paused) {
        window.dzPlayer.control.pause();
    }
  }
}

window.SW_PLUGIN = new DeezerPlugin();