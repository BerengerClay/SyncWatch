import tkinter as tk
from tkinter import ttk, messagebox
import socketio
import threading
import time

class SyncRemote:
    def __init__(self, server_url):
        self.url = server_url
        self.sio = socketio.Client()
        self.state = {"time": 0, "duration": 1, "paused": True, "last_update": time.time()}
        self.room_id = None
        self.is_dragging = False

        # --- Fenêtre Principale ---
        self.root = tk.Tk()
        self.root.title("SyncWatch - Télécommande")
        self.root.geometry("400x350")
        self.root.configure(bg="#1a1a1a")

        # --- Styles ---
        style = ttk.Style()
        style.theme_use('clam')
        style.configure("TLabel", foreground="white", background="#1a1a1a", font=("Helvetica", 10))
        style.configure("TButton", font=("Helvetica", 10, "bold"), padding=6)
        style.configure("Status.TLabel", font=("Helvetica", 12, "bold"))

        # --- UI : Header ---
        self.header = ttk.Label(self.root, text="🚀 SyncWatch Remote", style="TLabel", font=("Helvetica", 14, "bold"))
        self.header.pack(pady=20)

        # --- UI : Connexion ---
        conn_frame = tk.Frame(self.root, bg="#1a1a1a")
        conn_frame.pack(pady=10)
        self.room_entry = ttk.Entry(conn_frame, width=10, font=("Helvetica", 12))
        self.room_entry.pack(side=tk.LEFT, padx=5)
        self.join_btn = ttk.Button(conn_frame, text="Rejoindre", command=self.join_room)
        self.join_btn.pack(side=tk.LEFT)

        # --- UI : Statut ---
        self.status_label = ttk.Label(self.root, text="Non connecté", style="Status.TLabel", foreground="#ff4444")
        self.status_label.pack(pady=10)

        self.time_label = ttk.Label(self.root, text="00:00 / 00:00", font=("Consolas", 14), foreground="#00ffcc")
        self.time_label.pack(pady=5)

        # --- UI : Contrôles ---
        self.progress = ttk.Scale(self.root, from_=0, to=100, orient=tk.HORIZONTAL, length=300, command=self.on_seek_drag)
        self.progress.bind("<ButtonRelease-1>", self.on_seek_release)
        self.progress.pack(pady=15)

        self.play_btn = ttk.Button(self.root, text="▶ PLAY", command=self.toggle_play)
        self.play_btn.pack(pady=10)

        # --- Socket Events ---
        @self.sio.on('JOIN_SUCCESS')
        def on_join(data):
            self.room_id = self.room_entry.get().upper()
            self.root.after(0, lambda: self.status_label.config(text=f"Connecté: {self.room_id}", foreground="#00ff66"))
            self.update_state(data['initialState'])

        @self.sio.on('SYNC_ORDER')
        def on_sync(data):
            self.update_state(data)

        @self.sio.on('connect')
        def on_connect():
            print("Connected to socket server")

        # --- Boucle d'Update ---
        self.update_loop()

    def update_state(self, data):
        media = data.get('media', {})
        if not media: return
        self.state["time"] = media.get('time', self.state["time"])
        self.state["duration"] = media.get('duration', self.state["duration"]) or 1
        self.state["paused"] = media.get('paused', self.state["paused"])
        self.state["last_update"] = time.time()
        
        # Sync UI
        self.root.after(0, self.sync_ui_elements)

    def sync_ui_elements(self):
        btn_text = "▶ PLAY" if self.state["paused"] else "⏸ PAUSE"
        self.play_btn.config(text=btn_text)
        self.progress.config(to=self.state["duration"])

    def format_time(self, s):
        m, s = divmod(int(s), 60)
        h, m = divmod(m, 60)
        return f"{h:02d}:{m:02d}:{s:02d}" if h > 0 else f"{m:02d}:{s:02d}"

    def update_loop(self):
        if self.room_id and not self.is_dragging:
            elapsed = 0 if self.state["paused"] else (time.time() - self.state["last_update"])
            current_time = min(self.state["time"] + elapsed, self.state["duration"])
            
            self.time_label.config(text=f"{self.format_time(current_time)} / {self.format_time(self.state['duration'])}")
            self.progress.set(current_time)
            
        self.root.after(100, self.update_loop)

    def join_room(self):
        rid = self.room_entry.get().upper()
        if not rid: return
        threading.Thread(target=lambda: self._connect_and_join(rid), daemon=True).start()

    def _connect_and_join(self, rid):
        try:
            if not self.sio.connected:
                self.sio.connect(self.url, transports=['websocket'])
            self.sio.emit('JOIN_ROOM', rid)
        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror("Erreur", f"Connexion impossible: {e}"))

    def toggle_play(self):
        if not self.room_id: return
        elapsed = 0 if self.state["paused"] else (time.time() - self.state["last_update"])
        current_time = self.state["time"] + elapsed
        
        patch = {"paused": not self.state["paused"], "time": current_time}
        self.sio.emit('SEND_ACTION', {"ts": int(time.time()*1000), "data": {"media": patch}})

    def on_seek_drag(self, val):
        self.is_dragging = True

    def on_seek_release(self, event):
        if not self.room_id: return
        new_time = float(self.progress.get())
        self.sio.emit('SEND_ACTION', {"ts": int(time.time()*1000), "data": {"media": {"time": new_time}}})
        self.is_dragging = False

    def run(self):
        self.root.mainloop()

if __name__ == "__main__":
    app = SyncRemote("https://syncwatch-server.beclay.fr")
    app.run()
