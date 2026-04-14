import socketio
import time

# Configuration
SERVER_URL = "https://syncwatch-server.beclay.fr"
sio = socketio.Client()

@sio.event
def connect():
    print(f"✅ Connecté au serveur : {SERVER_URL}")

@sio.on('JOIN_SUCCESS')
def on_join(data):
    print(f"🎉 Room rejointe avec succès ! Host ID: {data['hostId']}")
    print(f"📊 État initial reçu : {data['initialState']}")
    
    # Attendre un peu avant d'envoyer l'action
    time.sleep(2)
    
    print("\n--- ⏯️ Envoi de l'ordre de PAUSE ---")
    packet = {
        "ts": int(time.time() * 1000),
        "data": {
            "media": {
                "paused": True
            }
        }
    }
    sio.emit('SEND_ACTION', packet)
    print("🚀 Action envoyée !")

@sio.on('SYNC_ORDER')
def on_sync(data):
    # C'est ce que les autres reçoivent quand tu envoies une action
    print(f"📥 Reçu SYNC_ORDER du serveur : {data}")

@sio.on('ERROR')
def on_error(data):
    print(f"❌ Erreur serveur : {data}")

@sio.event
def disconnect():
    print("🔌 Déconnecté du serveur")

if __name__ == "__main__":
    room_id = input("Entrez le Room ID (ex: ABCD12) : ").upper()
    
    try:
        # On utilise websocket uniquement pour la rapidité
        sio.connect(SERVER_URL, transports=['websocket'])
        
        # Rejoindre la room
        sio.emit('JOIN_ROOM', room_id)
        
        # Garder le script en vie pour écouter les réponses
        sio.wait()
    except Exception as e:
        print(f"💥 Erreur de connexion : {e}")
