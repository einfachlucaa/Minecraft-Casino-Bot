# 🎰 Casino Bot - Setup Anleitung

## Problem
Der Bot verbindet sich zum Server, wird aber sofort gekickt: `"Du bist bereits auf dem Server!"` oder `"You are not logged into your Minecraft account"`

## Lösung

### Option 1: Echten Minecraft-Account verwenden (EMPFOHLEN)

1. **Minecraft-Account kaufen/erstellen**
   - Gehe zu https://launcher.mojang.com/
   - Erstelle einen Microsoft-Account oder verbinde deinen bestehenden
   - Kaufe Minecraft Java Edition

2. **Bot-Konfiguration anpassen**
   - Öffne `config.js`
   - Ändere `username` zu deinem echten Minecraft-Username
   - Speichere die Datei

3. **Bot starten**
   ```powershell
   node bot.js
   ```
   - Der Bot öffnet automatisch einen Browser-Tab
   - Melde dich mit deinem Microsoft-Account an
   - Der Bot speichert das Token automatisch

### Option 2: Server im Offline-Mode starten (Für lokale Tests)

Spreche mit dem Server-Admin und frage ihn, den Server im **Offline-Mode** zu starten:

Dann ändere in `bot.js`:
```javascript
auth: false    // Offline mode
```

Und nutze einen beliebigen Username in `config.js`.

### Option 3: Debug - Echte Fehlermeldung sehen

Für Debugging die `disconnect`-Handler verbessern. Moment, lasse mich das machen:

