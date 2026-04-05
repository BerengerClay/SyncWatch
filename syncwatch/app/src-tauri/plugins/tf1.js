class TF1Plugin extends BaseSyncPlugin {
  constructor() {
    super();
    this.name = 'TF1+';
    this.currentTitle = 'Chargement...';
  }

  getVideo() { 
    return document.querySelector('#ntrs-video-media') || 
           document.querySelector('video[src*="blob"]'); 
  }

  getIframe() { 
    return document.querySelector('iframe[src*="prod-player.tf1.fr"]'); 
  }

  getContainerClasses() {
    return 'bg-blue-950/40 border-blue-500/20 shadow-[0_0_40px_rgba(30,58,138,0.3)]';
  }

  getVideoTitle() {
    const el = document.querySelector('h1') || 
               document.querySelector('.player-header__title') ||
               document.querySelector('#content h1') ||
               document.querySelector('h1[class*="ProgramTitle"]');
    return el ? el.innerText.trim() : 'Vidéo inconnue';
  }

  getContentTop() {
    const encoded = JSON.stringify(this.currentTitle);
    return `React.createElement('div', { 
        className: 'px-4 py-2 bg-blue-500/10 border border-blue-400/20 rounded-xl text-[10px] font-bold text-blue-300' 
    }, ${encoded})`;
  }
}

window.SW_PLUGIN = new TF1Plugin();
