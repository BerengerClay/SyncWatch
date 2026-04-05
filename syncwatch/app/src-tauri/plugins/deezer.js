class DeezerPlugin extends BaseSyncPlugin {
  constructor() {
    super();
    this.name = 'Deezer';
  }

  getContainerClasses() {
    return 'bg-[#A238FF]/10 border-[#A238FF]/30 shadow-[0_0_40px_rgba(162,56,255,0.15)]';
  }
}

window.SW_PLUGIN = new DeezerPlugin();
