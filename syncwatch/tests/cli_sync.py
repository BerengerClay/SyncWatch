import socketio
import time
import sys
import select
import tty
import termios
from rich.live import Live
from rich.panel import Panel
from rich.progress import ProgressBar
from rich.console import Console
from rich.table import Table

class SyncController:
    def __init__(self, server_url):
        self.sio = socketio.Client()
        self.url = server_url
        self.state = {
            "time": 0,
            "duration": 1,
            "paused": True,
            "last_update": time.time()
        }
        self.room_id = ""
        self.console = Console()
        self.running = True
        
        # NOUVEAU : Variables pour notre champ de texte interne
        self.seek_mode = False
        self.seek_buffer = ""

        @self.sio.on('JOIN_SUCCESS')
        def on_join(data):
            self.update_local_state(data['initialState'])

        @self.sio.on('SYNC_ORDER')
        def on_sync(data):
            self.update_local_state(data)

    def update_local_state(self, incoming):
        if not incoming: return
        media = incoming.get('media', {})
        if not media: return
        
        # On ne met à jour que les champs présents pour éviter d'écraser avec du vide
        if 'time' in media: self.state["time"] = media['time']
        if 'duration' in media: self.state["duration"] = media['duration'] or 1
        if 'paused' in media: self.state["paused"] = media['paused']
        
        # Important : on utilise le TS du serveur s'il existe, sinon le moment présent
        self.state["last_update"] = time.time()

    def get_extrapolated_time(self):
        if self.state["paused"]:
            return self.state["time"]
        elapsed = time.time() - self.state["last_update"]
        # Limite l'extrapolation à la durée réelle
        t = self.state["time"] + elapsed
        return min(max(0, t), self.state["duration"])

    def format_time(self, s):
        m = int(s // 60)
        sec = int(s % 60)
        return f"{m:02d}:{sec:02d}"

    def send_action(self, patch):
        packet = {
            "ts": int(time.time() * 1000),
            "data": {"media": patch}
        }
        self.sio.emit('SEND_ACTION', packet)

    def generate_ui(self):
        current_time = self.get_extrapolated_time()
        percent = (current_time / self.state["duration"]) * 100 if self.state["duration"] > 0 else 0
        
        status = "[bold red]PAUSE[/]" if self.state["paused"] else "[bold green]LECTURE[/]"
        
        table = Table.grid(expand=True)
        table.add_column()
        table.add_row(f"📍 Room: [bold cyan]{self.room_id}[/] | Statut: {status}")
        table.add_row(f"🕒 {self.format_time(current_time)} / {self.format_time(self.state['duration'])}")
        
        progress = ProgressBar(total=100, completed=percent, width=60)
        
        content = Table.grid(expand=True)
        content.add_row(table)
        
        # NOUVEAU : On affiche le champ de recherche dynamique si le mode est activé
        if self.seek_mode:
            content.add_row(f"[bold yellow]▶ Aller à (secondes) : {self.seek_buffer}█[/]")
        else:
            content.add_row(" ") # Espace vide pour garder la même hauteur
            
        content.add_row(progress)

        # NOUVEAU : On change le sous-titre selon le mode
        subtitle = "[bold yellow]Entrée: Valider | Esc: Annuler[/]" if self.seek_mode else "[dim]p: Play/Pause | s: Seek | q: Quitter[/]"

        return Panel(
            content,
            title="[bold white]SyncWatch CLI Controller[/]",
            subtitle=subtitle,
            padding=(1, 2)
        )

    def start(self, room_id):
        self.room_id = room_id.upper()
        try:
            if not self.sio.connected:
                self.sio.connect(self.url, transports=['websocket'])
            self.sio.emit('JOIN_ROOM', self.room_id)
        except Exception as e:
            self.console.print(f"[bold red]Erreur de connexion:[/] {e}")
            self.running = False

if __name__ == "__main__":
    console = Console()
    controller = SyncController("https://syncwatch-server.beclay.fr")
    
    console.print("[bold cyan]SyncWatch CLI[/] - Entrez le [bold white]Room ID[/] (ex: ABCD12) : ", end="")
    rid = input().upper()
    
    controller.start(rid)

    # Sauvegarde des paramètres du terminal pour les restaurer à la fin
    old_settings = termios.tcgetattr(sys.stdin)
    
    try:
        # Passage en mode discret (on capture les touches une par une)
        tty.setcbreak(sys.stdin.fileno())

        with Live(controller.generate_ui(), refresh_per_second=10) as live:
            
            while controller.running:
                live.update(controller.generate_ui())
                
                # Attente d'une touche pendant 0.1s
                if select.select([sys.stdin], [], [], 0.1)[0]:
                    key = sys.stdin.read(1)
                    
                    # === MODE RECHERCHE ACTIVÉ ===
                    if controller.seek_mode:
                        if key in ('\n', '\r'): # Touche Entrée
                            try:
                                if controller.seek_buffer:
                                    target = float(controller.seek_buffer)
                                    controller.send_action({"time": target})
                            except ValueError:
                                pass
                            controller.seek_mode = False
                            controller.seek_buffer = ""
                            
                        elif key in ('\x7f', '\b'): # Touche Retour Arrière
                            controller.seek_buffer = controller.seek_buffer[:-1]
                            
                        elif key == '\x1b': # Touche Echap
                            controller.seek_mode = False
                            controller.seek_buffer = ""
                            
                        elif key.isdigit() or key == '.': # On n'autorise que les chiffres et le point
                            controller.seek_buffer += key
                            
                    # === MODE NORMAL ===
                    else:
                        key = key.lower()
                        if key == 'q':
                            controller.running = False
                        elif key == 'p':
                            # CORRECTION : On n'envoie QUE le switch de pause, pas le temps.
                            # Cela évite de faire sauter la timeline à cause d'une petite dérive.
                            controller.send_action({
                                "paused": not controller.state["paused"]
                            })
                        elif key == 's':
                            controller.seek_mode = True
                            controller.seek_buffer = ""

    except KeyboardInterrupt:
        controller.running = False
    except Exception as e:
        console.print(f"\n[bold red]Crash:[/] {e}")
    finally:
        # ABSOLUMENT IMPORTANT : Restaurer le terminal
        termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
        if controller.sio.connected:
            controller.sio.disconnect()
        console.print("\n[yellow]Au revoir ![/]")