# Kritzelkönig – Technischer Entwurf (MVP)

**Projekt:** WLAN-Zeichnen-und-Raten-Spiel im Landscape-Modus
**Plattform:** Android (Landscape), lokaler Multiplayer im selben WLAN
**Engine/Sprache:** Unity 2022 LTS, C#
**Netzwerk:** TCP-Sockets (Spieldaten) + UDP-Broadcast (Raum-Discovery, das Unity-Äquivalent zu Androids NSD)
**Ziel:** Einfacher, stabiler, später erweiterbarer Prototyp – „Jeder gegen jeden", Sieg bei 10 Punkten.

---

## 0. Leitprinzipien für den MVP

1. **Host ist die einzige Wahrheit (Authoritative Host).** Nur der Host hält den echten Spielzustand, wählt Begriffe, prüft Antworten, zählt Punkte, schaltet Runden. Clients zeigen nur an, was der Host sendet, und senden Eingaben (Striche, Rateversuche).
2. **Geheimnis bleibt geheim.** Der echte Begriff verlässt den Host nur in Richtung des aktuellen Zeichners. Alle anderen erhalten ausschließlich Wortlänge + aufgedeckte Buchstaben.
3. **Eine Codebasis, zwei Rollen.** Dieselbe App ist Host oder Client – die Rolle wird zur Laufzeit gesetzt. Der Host ist zusätzlich ein „lokaler Client" für sich selbst (er spielt mit).
4. **Klein, stabil, testbar.** Lieber wenige robuste Nachrichtentypen als ein komplexes Protokoll. Erweiterungen (Farben, Teams, Chaoskarten) sind bewusst ausgeklammert, aber die Struktur lässt sie zu.

---

## 1. Architektur

### 1.1 Schichtenmodell

```
┌─────────────────────────────────────────────────────────────┐
│  PRESENTATION (Unity Scenes / UI Toolkit / Canvas)           │
│  MainMenu · Lobby · Game (Drawer/Guesser) · GameOver         │
├─────────────────────────────────────────────────────────────┤
│  GAME LOGIC (rein C#, engine-nah, aber UI-unabhängig)        │
│  GameStateMachine · RoundController · ScoreService           │
│  WordProvider · HintEngine · GuessMatcher                    │
├─────────────────────────────────────────────────────────────┤
│  NETWORK (Transport + Protokoll)                             │
│  HostServer (TCP) · ClientConnection (TCP)                   │
│  RoomDiscovery (UDP-Broadcast) · MessageSerializer (JSON)    │
├─────────────────────────────────────────────────────────────┤
│  MODEL (reine Daten, serialisierbar)                         │
│  Player · GameRoom · Word · RoundState · Guess · Stroke      │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Zentrale Komponenten

| Komponente | Läuft auf | Aufgabe |
|---|---|---|
| `GameManager` (Singleton, `DontDestroyOnLoad`) | beide | Hält Rolle (Host/Client), eigene PlayerId, Szenenwechsel, Referenz auf Netzwerk |
| `HostServer` | nur Host | TCP-Listener, Clientverwaltung, betreibt die `GameStateMachine` |
| `ClientConnection` | beide | TCP-Verbindung zum Host; empfängt State-Updates, sendet Eingaben (Host verbindet sich „virtuell" über In-Memory-Bus) |
| `RoomDiscovery` | beide | Host sendet UDP-Beacons mit Raum-Code + IP/Port; Client hört zu und löst Code → IP auf |
| `GameStateMachine` | nur Host | Steuert die States (siehe §4) |
| `RoundController` | nur Host | Begriffwahl, Timer, Hinweise, Trefferprüfung, Rundenwechsel |
| `WordProvider` | nur Host | Begriffsliste, zufällige Auswahl ohne Wiederholung |
| `HintEngine` | nur Host | Aufdecken von Buchstaben nach Regeln (§7) |
| `GuessMatcher` | nur Host | Normalisierung + Vergleich (§8) |
| `DrawingSurface` | beide | Rendern der Striche; auf dem Zeichnergerät zusätzlich Eingabe (§9) |
| `NetEventBus` | beide | Entkoppelt Netzwerk-Empfang von Unity-Mainthread (Queue, im `Update()` abgearbeitet) |

### 1.3 Thread-Modell

Sockets laufen in eigenen Threads (Blocking-IO ist für einen MVP am einfachsten und am stabilsten). Empfangene Nachrichten werden in eine **thread-sichere Queue** gelegt und im Unity-Mainthread (`Update`) verarbeitet. **Regel: Keine Unity-API aus Netzwerk-Threads.** Das vermeidet 90 % der typischen Multiplayer-Abstürze.

### 1.4 Host als Mitspieler

Der Host startet `HostServer` und verbindet sich selbst über einen **In-Memory-Loopback** (kein echter Socket nötig) an dieselbe `GameStateMachine`. So bleibt die Spiellogik identisch, egal ob eine Nachricht von außen oder vom Host selbst kommt.

---

## 2. Übersicht aller Screens

| # | Screen / Scene | Rolle | Zweck |
|---|---|---|---|
| 1 | **MainMenu** | beide | Name eingeben, Spiel erstellen oder beitreten |
| 2 | **CreateRoom** | Host | Raum wird erzeugt, Code wird angezeigt (kann Teil der Lobby sein) |
| 3 | **JoinRoom** | Client | Raum-Code eingeben, verbinden |
| 4 | **Lobby** | beide | Spielerliste, Raum-Code, Host startet |
| 5 | **Game – Drawer** | aktueller Zeichner | Begriff, Canvas + Werkzeuge, Timer, Hinweisanzeige |
| 6 | **Game – Guesser** | alle anderen | Live-Zeichnung, Rateeingabe, Timer, Hinweisanzeige |
| 7 | **Round Transitions (Overlay)** | beide | „Richtig geraten", „Zeit abgelaufen", Auflösung, „X zeichnet jetzt" |
| 8 | **GameOver** | beide | Gewinner, Endstand, Neues Spiel / Zur Lobby |
| 9 | **Disconnected (Overlay)** | beide | Verbindung verloren, Rückkehr ins Menü |

**Unity-Umsetzung:** Drei Scenes (`MainMenu`, `Lobby`, `Game`) reichen. Drawer/Guesser sind **dieselbe Scene**, die je nach Rolle nur unterschiedliche UI-Panels einblendet. Übergänge und Disconnect sind Overlays innerhalb der jeweiligen Scene.

---

## 3. Benutzeroberfläche im Landscape-Modus

**Globale Vorgaben:** `PlayerSettings → Default Orientation = Landscape Left/Right`, Auto-Rotation nur Landscape. Canvas Scaler auf „Scale With Screen Size", Referenzauflösung **1920×1080**, Match = 0,5. Großzügige Touch-Ziele (≥ 64 px), da am Tisch schnell getippt wird.

### 3.1 MainMenu (Querformat, zentriert)

```
┌───────────────────────────────────────────────────────────┐
│                     K R I T Z E L K Ö N I G                 │
│                                                             │
│        Spielername:  [ __________________ ]                 │
│                                                             │
│      ┌───────────────────┐   ┌───────────────────┐         │
│      │   SPIEL ERSTELLEN │   │   SPIEL BEITRETEN  │         │
│      └───────────────────┘   └───────────────────┘         │
│                              Raum-Code: [ _ _ _ _ ]         │
└───────────────────────────────────────────────────────────┘
```

### 3.2 Lobby

```
┌───────────────────────────────────────────────────────────┐
│  RAUM-CODE:   ┌─────────┐                                   │
│               │  4 7 2 9 │   (sehr groß, gut ablesbar)      │
│               └─────────┘                                   │
│                                                             │
│  Spieler:                          [ SPIEL STARTEN ]        │
│   • Anna   (Host) 👑                  (nur Host sichtbar,   │
│   • Ben                                aktiv ab 2 Spielern) │
│   • Carla                                                   │
│                                    „Warte auf weitere       │
│                                     Spieler …"              │
└───────────────────────────────────────────────────────────┘
```

### 3.3 Spielbildschirm – Zeichner (Drawer)

Aufteilung: **Canvas dominiert** (Mitte/links), Werkzeuge in einer schmalen vertikalen Leiste, Status oben.

```
┌───────────────────────────────────────────────────────────┐
│ Begriff: KATZE        ⏱ 0:48        Du zeichnest ✏          │
│ Punkte: Anna 3 · Ben 5 · Carla 2                            │
├──────────────────────────────────────────────┬────────────┤
│                                                │  ┌──────┐  │
│                                                │  │Pinsel│  │
│            WEISSE ZEICHENFLÄCHE                │  └──────┘  │
│                                                │  ┌──────┐  │
│                                                │  │Radier│  │
│                                                │  └──────┘  │
│                                                │  ┌──────┐  │
│                                                │  │ Undo │  │
│                                                │  └──────┘  │
│                                                │  ┌──────┐  │
│                                                │  │Leeren│  │
├──────────────────────────────────────────────┴────────────┤
│  Lösung:   _ A T _ _                                        │
└───────────────────────────────────────────────────────────┘
```

### 3.4 Spielbildschirm – Rater (Guesser)

Wie oben, **aber ohne Begriff und ohne Werkzeugleiste**; stattdessen unten ein Eingabefeld.

```
┌───────────────────────────────────────────────────────────┐
│ Anna zeichnet …       ⏱ 0:48                                │
│ Punkte: Anna 3 · Ben 5 · Carla 2                            │
├───────────────────────────────────────────────────────────┤
│                                                             │
│            LIVE-ZEICHNUNG (nur Ansicht)                     │
│                                                             │
├───────────────────────────────────────────────────────────┤
│  Lösung:  _ A T _ _      [ Dein Tipp … ____ ]  [ SENDEN ]   │
└───────────────────────────────────────────────────────────┘
```

### 3.5 Übergangs-Overlays

- **Richtig:** zentrierter Banner „✅ Ben hat richtig geraten! (+1)" → kurz halten (~2 s) → „Ben zeichnet jetzt".
- **Timeout:** „⏱ Zeit abgelaufen – Das Wort war: KATZE" (~3 s).
- **Disconnect:** abgedunkeltes Overlay „Verbindung verloren" + Button „Zum Menü".

### 3.6 GameOver

```
┌───────────────────────────────────────────────────────────┐
│                  🏆  BEN HAT GEWONNEN!                      │
│                                                             │
│        Endstand:  Ben 10 · Anna 7 · Carla 5                │
│                                                             │
│       [ NEUES SPIEL ]            [ ZUR LOBBY ]              │
└───────────────────────────────────────────────────────────┘
```

---

## 4. Game-State-Struktur (State Machine)

Die Logik liegt beim Host. Clients spiegeln den State nur, um die richtige UI zu zeigen.

```
        MainMenu
        ┌──┴───┐
   CreateRoom  JoinRoom
        └──┬───┘
         Lobby ───────────────┐ (Host: Start)
           │                  │
       RoundStart  ◄──────────┘
           │ (Begriff wählen, Canvas leeren, an Drawer senden)
           ▼
      DrawingActive  ── Timer 60s, Striche + Rateversuche
        ┌──┴───────────┐
   (richtig)        (Zeit = 0)
        ▼               ▼
   RoundSolved     RoundTimeout
        │               │ (Auflösung zeigen, nächster reihum)
        ├──► (10 Punkte?) ── ja ──► GameOver
        │               │
        └───────┬───────┘
                ▼
            RoundStart   (nächste Runde)

  Jeder State kann nach  Disconnected  wechseln (Host weg / Verbindung verloren)
  GameOver ──► Lobby (Zur Lobby)  oder  RoundStart (Neues Spiel, Scores=0, usedWords leeren)
```

**Zustände im Detail**

| State | Wer bestimmt | Was passiert |
|---|---|---|
| `MainMenu` | lokal | Name/Aktion wählen |
| `CreateRoom` | Host | Raum-Code generieren, Server starten, UDP-Beacon starten |
| `JoinRoom` | Client | Code eingeben → Discovery → TCP-Verbindung |
| `Lobby` | Host | Spieler sammeln, Liste broadcasten, auf Start warten |
| `RoundStart` | Host | Zeichner festlegen, Begriff wählen, Canvas leeren, Timer setzen, Rollen verteilen |
| `DrawingActive` | Host | Striche weiterleiten, Rateversuche prüfen, Hinweise timen |
| `RoundSolved` | Host | Punkt vergeben, Gewinner-Check, nächster Zeichner = Rater |
| `RoundTimeout` | Host | Wort auflösen, nächster Zeichner reihum |
| `GameOver` | Host | Gewinner ermitteln, Endstand senden |
| `Disconnected` | beide | Fehlerbehandlung, Rückkehr ins Menü |

---

## 5. Datenmodelle

Alle Modelle sind **reine, JSON-serialisierbare C#-Klassen** (für `JsonUtility`/Newtonsoft). IDs als `string` (GUID-Kurzform) – stabil über Reconnects.

```csharp
public enum GameState {
    MainMenu, CreateRoom, JoinRoom, Lobby,
    RoundStart, DrawingActive, RoundSolved, RoundTimeout,
    GameOver, Disconnected
}

public enum ConnectionState { Connecting, Connected, Disconnected }
public enum ToolType { Brush, Eraser, Undo, Clear }
public enum Difficulty { Easy, Medium, Hard }

[Serializable]
public class Player {
    public string  playerId;
    public string  name;
    public int     score;
    public bool    isHost;
    public bool    isCurrentDrawer;
    public ConnectionState connectionState;
}

[Serializable]
public class GameRoom {
    public string       roomCode;          // z.B. "4729"
    public string       hostId;
    public List<Player> players;
    public GameState    gameState;
    public string       currentDrawerId;
    public string       currentWordId;
    public List<string> usedWordIds;       // verhindert Wiederholung
    public int          targetScore = 10;
}

[Serializable]
public class Word {
    public string     wordId;
    public string     text;            // "Katze"  (nur Host + Zeichner)
    public string     category;        // "Tiere"
    public Difficulty difficulty;
    public string     normalizedText;  // "katze" (vorberechnet, §8)
}

[Serializable]
public class RoundState {
    public string      currentWordId;      // an Clients: nur ID, nie text
    public int         wordLength;         // für die Unterstrich-Anzeige
    public List<int>   visibleLetterIndex; // aufgedeckte Positionen
    public char[]      visibleLetters;     // gespiegelte Anzeige (Rest = '_')
    public List<int>   spaceIndexes;       // Leerzeichen/Bindestrich-Positionen
    public float       remainingTime;      // Sekunden
    public bool        isSolved;
    public string      drawerId;
    public int         roundNumber;
}

[Serializable]
public class Guess {
    public string playerId;
    public string text;
    public string normalizedText;
    public long   timestamp;       // Unix ms
    public bool   isCorrect;
}

[Serializable]
public class DrawingStroke {
    public string        strokeId;
    public string        playerId;
    public ToolType      toolType;
    public List<Vector2> points;       // normalisiert 0..1 (auflösungsunabhängig!)
    public float         lineWidth;    // ebenfalls relativ zur Canvasbreite
    public long          timestamp;
}
```

**Wichtige Designentscheidung – normalisierte Koordinaten:** Striche werden in `0..1`-Koordinaten relativ zur Canvasfläche übertragen, nicht in Pixeln. So sieht die Zeichnung auf jedem Gerät unabhängig von Auflösung/Seitenverhältnis gleich aus.

---

## 6. Multiplayer-Logik im lokalen WLAN

### 6.1 Discovery (Raum-Code → IP)

Da Unity kein Androids NSD direkt nutzt, übernimmt **UDP-Broadcast** dieselbe Rolle (zuverlässig im selben WLAN):

1. Host startet TCP-Server auf freiem Port (z. B. 7777) und beginnt, im Sekundentakt ein **UDP-Beacon** an die Broadcast-Adresse (`255.255.255.255:7778`) zu senden:
   `{ "code": "4729", "host": "Anna", "ip": "192.168.0.23", "port": 7777, "players": 3 }`
2. Beim Beitreten hört der Client kurz auf Port 7778, sammelt Beacons und sucht das mit passendem Code → erhält IP + Port → baut TCP-Verbindung auf.
3. **Fallback (Robustheit):** Findet die Discovery nichts (manche WLANs blocken Broadcast), bietet die UI optional die manuelle Eingabe der Host-IP an.

### 6.2 Verbindung & Sitzung

- Transport: **TCP**, ein persistenter Socket pro Client (zuverlässig, in richtiger Reihenfolge – ideal für Striche und Spielzustand).
- Framing: Jede Nachricht = **4-Byte-Längenpräfix + JSON-UTF8** (verhindert „zusammengeklebte" Pakete).
- Heartbeat: Alle 2–3 s `Ping`/`Pong`; bleibt der Pong > ~6 s aus → `connectionState = Disconnected`.

### 6.3 Nachrichtenprotokoll (MVP – bewusst klein)

Jede Nachricht: `{ "type": "...", "payload": { ... } }`.

**Client → Host**
| type | payload | Zweck |
|---|---|---|
| `JoinRequest` | `{ name }` | Beitritt anfragen |
| `StartGame` | – | nur Host-Client, startet Partie |
| `Stroke` | `DrawingStroke` (Start/Move/End teilbar) | Zeichen-Event |
| `EraserStroke` | `DrawingStroke` (toolType=Eraser) | Radieren |
| `Undo` | – | letzten eigenen Strich zurück |
| `Clear` | – | Canvas leeren (nur Zeichner) |
| `GuessSubmit` | `{ text }` | Rateversuch |
| `Pong` | – | Heartbeat-Antwort |

**Host → Client(s)**
| type | Empfänger | payload | Zweck |
|---|---|---|---|
| `JoinAccepted` | 1 | `{ playerId, roomCode }` | Beitritt bestätigt |
| `RoomUpdate` | alle | `GameRoom` (ohne `Word.text`) | Spielerliste, State, Punkte |
| `RoundStarted` | alle | `RoundState` (Länge, keine Buchstaben) | neue Runde |
| `WordAssignment` | **nur Zeichner** | `{ text, category }` | der geheime Begriff |
| `StrokeBroadcast` | alle außer Sender | `DrawingStroke` | Live-Zeichnung verteilen |
| `ClearCanvas` | alle | – | Fläche leeren |
| `HintUpdate` | alle | `{ visibleLetters }` | aufgedeckte Buchstaben |
| `TimerTick` | alle | `{ remainingTime }` | ~1×/s |
| `GuessResult` | alle | `{ playerId, isCorrect }` | richtig/falsch (Text nur bei korrekt) |
| `RoundSolved` | alle | `{ winnerId, word, scores }` | Auflösung + Punkt |
| `RoundTimeout` | alle | `{ word, nextDrawerId }` | Zeit abgelaufen + Auflösung |
| `GameOver` | alle | `{ winnerId, scores }` | Sieg bei 10 |
| `Ping` | alle | – | Heartbeat |

### 6.4 Geheimhaltung (kritisch)

- `Word.text` wird **nie** in `RoomUpdate`/`RoundStarted` mitgesendet – nur `wordLength`.
- Der Begriff geht ausschließlich als `WordAssignment` an genau **einen** Socket (den Zeichner).
- Hinweise (`HintUpdate`) enthalten nur die bereits aufgedeckten Buchstaben, nie das ganze Wort während der Runde.

### 6.5 Ablauf einer Runde (Sequenz)

```
Host: wähle Zeichner D, wähle Wort W (nicht in usedWordIds)
Host → D        : WordAssignment(W.text, W.category)
Host → alle      : RoundStarted(length=len(W), spaces=…)
Host → alle      : ClearCanvas
Host: starte Timer 60s

[laufend]
 D    → Host      : Stroke / Eraser / Undo / Clear
 Host → andere    : StrokeBroadcast / ClearCanvas
 Rater→ Host      : GuessSubmit(text)
 Host: normalize+vergleiche
   falsch → Host → alle: GuessResult(isCorrect=false)
   richtig→ Host: score[Rater]++; Host → alle: RoundSolved(winner, W.text, scores)
            wenn score==10 → GameOver  sonst nextDrawer = Rater → RoundStart
 bei t=40/20/10 → Host → alle: HintUpdate(...)   (siehe §7)

[Timeout t=0, ungelöst]
 Host → alle      : RoundTimeout(W.text, nextDrawer = reihum)
 Host             : RoundStart
```

### 6.6 Verbindungsabbrüche (MVP-Strategie)

- **Client trennt:** Host entfernt Spieler aus der Liste, broadcastet `RoomUpdate`. War es der Zeichner → laufende Runde als Timeout behandeln, nächster reihum.
- **Host trennt:** Clients zeigen `Disconnected`-Overlay und kehren ins Menü zurück (kein Host-Migration im MVP – bewusst einfach).
- Reconnect (gleiche `playerId`) ist später erweiterbar, im MVP nicht nötig.

---

## 7. Timer- und Hinweislogik

### 7.1 Timer

- Host hält die **autoritative Zeit** (`remainingTime`, Start 60 s). Ein einziger Timer auf dem Host.
- `TimerTick` ~1×/Sekunde an alle – Clients zeigen nur an, rechnen nicht selbst (kein Drift).
- Bei `remainingTime <= 0` und ungelöst → `RoundTimeout`.

### 7.2 Hinweis-Engine (Buchstaben aufdecken)

**Auslösezeitpunkte** (gemessen ab Rundenstart, 60-s-Runde):

| Zeitpunkt | Aktion |
|---|---|
| Start (60 s) | nur Unterstriche, Leerzeichen sichtbar |
| nach 20 s (40 verbleibend) | 1 zufälligen Buchstaben aufdecken |
| nach 40 s (20 verbleibend) | 1 weiteren aufdecken |
| nach 50 s (10 verbleibend) | optional 1 dritten (nur bei längeren Wörtern) |

**Auswahlregeln**

- Position 0 (erster Buchstabe) **nicht als erster** Hinweis – bevorzugt Mitte/spätere Positionen.
- Keine bereits sichtbare Position erneut wählen.
- Leerzeichen/Bindestriche sind **von Anfang an sichtbar** (zählen nicht als Hinweis).
- **Nie alle** Buchstaben automatisch aufdecken – Obergrenze abhängig von Wortlänge.
- Kurze Wörter (≤ 3 Buchstaben): höchstens 1 Hinweis. Lange Wörter (≥ 8): bis zu 3.

**Pseudocode**

```csharp
// maxHints abhängig von Länge (ohne Leerzeichen)
int letterCount = word.Count(c => c != ' ' && c != '-');
int maxHints = letterCount <= 3 ? 1 : letterCount <= 7 ? 2 : 3;

List<int> RevealNext(Word w, List<int> alreadyVisible) {
    var candidates = AllLetterPositions(w)            // ohne Spaces/Bindestriche
        .Where(i => !alreadyVisible.Contains(i))
        .ToList();

    // erster Hinweis: Position 0 ausschließen, Mitte bevorzugen
    if (alreadyVisible.Count == 0) {
        var notFirst = candidates.Where(i => i != 0).ToList();
        if (notFirst.Count > 0) candidates = notFirst;
        // Mitte gewichten: sortiere nach Abstand zur Wortmitte (kleinster zuerst),
        // dann wähle aus den vordersten zufällig
        int mid = w.text.Length / 2;
        candidates = candidates.OrderBy(i => Math.Abs(i - mid)).Take(3).ToList();
    }
    if (alreadyVisible.Count >= maxHints || candidates.Count == 0)
        return alreadyVisible;                        // Obergrenze: nichts mehr aufdecken

    int pick = candidates[Random.Range(0, candidates.Count)];
    alreadyVisible.Add(pick);
    return alreadyVisible;
}

// Anzeige bauen
string BuildDisplay(Word w, List<int> visible) {
    var sb = new StringBuilder();
    for (int i = 0; i < w.text.Length; i++) {
        char c = w.text[i];
        if (c == ' ')         sb.Append("   ");       // Leerzeichen sichtbar
        else if (c == '-')    sb.Append(" - ");
        else if (visible.Contains(i)) sb.Append(char.ToUpper(c) + " ");
        else                  sb.Append("_ ");
    }
    return sb.ToString().TrimEnd();
}
```

Beispiel „KATZE": Start `_ _ _ _ _` → 40 s `_ _ T _ _` → 20 s `_ A T _ _` → 10 s optional `_ A T Z _`.
Beispiel „ROTER BALL": Start `_ _ _ _ _   _ _ _ _` (Leerzeichen bleibt sichtbar).

---

## 8. Treffererkennung

Vergleich findet **nur auf dem Host** statt. Eingabe und Begriff werden gleich normalisiert, dann exakt verglichen (MVP).

**Normalisierungsschritte**

1. Trim (Leerzeichen vorn/hinten entfernen).
2. In Kleinbuchstaben (`ToLowerInvariant`).
3. Umlaute/ß auflösen: `ä→ae, ö→oe, ü→ue, ß→ss`.
4. Restliche Akzente/Diakritika entfernen (Unicode-Normalisierung NFD, Kombinationszeichen streichen).
5. Mehrfache Leerzeichen zu einem zusammenfassen (für mehrteilige Begriffe).

```csharp
public static string Normalize(string input) {
    if (string.IsNullOrWhiteSpace(input)) return "";
    string s = input.Trim().ToLowerInvariant();
    s = s.Replace("ä","ae").Replace("ö","oe").Replace("ü","ue").Replace("ß","ss");
    // Diakritika entfernen
    s = new string(s.Normalize(NormalizationForm.FormD)
                    .Where(c => CharUnicodeInfo.GetUnicodeCategory(c)
                                != UnicodeCategory.NonSpacingMark).ToArray());
    s = Regex.Replace(s, @"\s+", " ");
    return s;
}

public bool IsCorrect(string guess, Word target) =>
    Normalize(guess) == target.normalizedText;   // normalizedText = Normalize(target.text)
```

Damit gelten „Katze", „katze", „ KATZE " alle als richtig. `normalizedText` jedes Worts wird **einmal vorab** beim Laden der Liste berechnet.

**Erweiterbar (nicht im MVP):** Synonyme/Alternativschreibweisen als Liste pro Wort; Tippfehler-Toleranz via Levenshtein-Distanz (z. B. Abstand ≤ 1 bei langen Wörtern).

---

## 9. Zeichenfläche – technische Umsetzung

**Empfehlung für Unity-MVP: `LineRenderer`-basierte Striche bzw. Mesh-Striche statt Pixel-Malen.**

| Ansatz | Bewertung |
|---|---|
| **A) Texture2D / SetPixels (Bitmap-Malen)** | Einfach vorstellbar, aber teuer (CPU), Undo schwer, Radierer = Pixel löschen, Synchronisation müsste Bilder schicken. **Nicht empfohlen.** |
| **B) Striche als Objekte (LineRenderer / UI-Vektorlinien)** ✅ | Jeder Strich = Liste von Punkten. Undo = letzten Strich-Container löschen. Radierer = weißer Strich darüber. Übertragung = nur Punktlisten (klein!). **Für MVP ideal.** |

**Umsetzung Variante B (empfohlen)**

- Eine `RectTransform`-Canvasfläche mit weißem Hintergrund (eigener Layer/Maske, damit Striche nicht überlaufen).
- Touch/Drag → Punkte sammeln. Beim `StrokeStart` neues Strich-GameObject (LineRenderer/UI-Line) anlegen, bei `StrokeMove` Punkte anhängen, bei `StrokeEnd` abschließen.
- **Pinsel:** schwarze Linie, feste Breite (relativ zur Canvasbreite).
- **Radierer:** Linie in Hintergrundfarbe (weiß), etwas breiter. (Echtes „Wegradieren" einzelner überlappender Striche ist komplexer – für den MVP genügt der weiße Überzeichner.)
- **Undo:** Striche liegen als Stack vor; Undo entfernt das oberste Strich-GameObject des jeweiligen Spielers und sendet `Undo`.
- **Clear:** alle Strich-Objekte löschen, `Clear` senden.

**Performance / Netzwerk**

- Punkte beim Ziehen **drosseln** (z. B. nur senden, wenn der Finger sich > N Pixel bewegt hat, oder alle ~30–50 ms gebündelt). Verhindert Paketflut.
- Punkte in **normalisierten 0..1-Koordinaten** senden (siehe §5) → gerätunabhängig.
- Empfangende Clients zeichnen Striche identisch nach (gleiche Strich-Objekte aus den Punktlisten).
- Striche werden auf dem Host **mitgeführt**, damit ein spät beitretender/neuzeichnender Stand konsistent ist (im MVP reicht: Canvas startet je Runde leer).

---

## 10. Empfohlene Entwicklungsreihenfolge

In Schritten, die jeweils **lauffähig und testbar** sind:

1. **Projekt-Setup & Landscape.** Unity-Projekt, Android-Build-Target, Orientierung fix Landscape, Canvas-Scaler, drei Scenes anlegen. *Test: leere App startet quer auf dem Gerät.*
2. **Datenmodelle + Enums.** Alle Klassen aus §5 als reine C#-Dateien. *Test: kompiliert, JSON-Serialisierung rund-trip.*
3. **Zeichenfläche offline.** Variante B: Pinsel, Radierer, Undo, Clear – nur lokal, ohne Netzwerk. *Test: man kann zeichnen/radieren/zurück.*
4. **Wortliste + Normalisierung + GuessMatcher.** `WordProvider` (Begriffe + Kategorien), `Normalize`, `IsCorrect`. *Test: Unit-Tests „Katze/ KATZE / katze" = richtig.*
5. **Hint-Engine.** `RevealNext` + `BuildDisplay` mit den Regeln aus §7. *Test: Unit-Tests – Pos 0 nicht zuerst, nie alle aufgedeckt, Leerzeichen sichtbar.*
6. **Lokale Spiel-Schleife (1 Gerät, ohne Netzwerk).** State Machine, RoundController, Timer, Score, Sieg bei 10 – mit simulierten Ratern. *Test: komplette Partie auf einem Gerät durchspielbar.*
7. **TCP-Transport + Framing + JSON-Protokoll.** `HostServer`, `ClientConnection`, Längen-Präfix, `NetEventBus` (Thread→Mainthread). *Test: zwei Geräte, Chat-artige Testnachricht kommt an.*
8. **Lobby über Netzwerk.** JoinRequest/JoinAccepted/RoomUpdate, Spielerliste, Host startet. *Test: 2–3 Geräte sehen dieselbe Lobby + Code.*
9. **UDP-Discovery (Raum-Code).** Beacon senden/empfangen, Code→IP, plus IP-Fallback. *Test: Beitritt nur per 4-stelligem Code.*
10. **Live-Zeichnung über Netzwerk.** Stroke/Eraser/Undo/Clear broadcasten + nachzeichnen, mit Drosselung. *Test: Zeichnung erscheint flüssig auf allen Geräten.*
11. **Runden-Synchronisation.** WordAssignment nur an Zeichner, RoundStarted/Timer/Hint/GuessResult/RoundSolved/RoundTimeout, Rollen-UI (Drawer vs. Guesser). *Test: vollständige Multiplayer-Runde inkl. Geheimhaltung des Begriffs.*
12. **GameOver + Neustart.** Sieg bei 10, Endstand, „Neues Spiel" (Scores/usedWords zurücksetzen) / „Zur Lobby". *Test: Partie bis zum Sieg.*
13. **Robustheit.** Heartbeat, Disconnect-Handling (Client weg / Zeichner weg / Host weg), Overlays. *Test: Gerät mitten im Spiel trennen – App bleibt stabil.*
14. **Feinschliff.** Übergangs-Banner, Lesbarkeit Querformat, Touch-Größen, kleine Klangeffekte optional.

**Reihenfolge-Logik:** Erst die Spiellogik **offline** vollständig und testbar machen (Schritte 1–6), dann das Netzwerk **darüberlegen** (7–11). Das ist der stabilste Weg – Bugs lassen sich isolieren, weil Logik und Transport getrennt entwickelt werden.

---

## 11. Begriffsliste (Startdaten für den MVP)

Kategorien laut Vorgabe; je Begriff `category` + `difficulty`. Auswahl ohne Wiederholung über `usedWordIds`.

| Kategorie | Begriffe (Beispiele) |
|---|---|
| Tiere | Katze, Hund, Fisch, Vogel, Maus, Schlange, Elefant |
| Essen | Pizza, Eis, Apfel, Brot, Banane, Kuchen, Käse |
| Gegenstände | Hut, Schuh, Ball, Tasse, Schlüssel, Krone, Brille |
| Fahrzeuge | Auto, Fahrrad, Flugzeug, Schiff, Zug, Bus, Rakete |
| Natur | Sonne, Mond, Baum, Blume, Berg, Wolke, Stern |
| Berufe | Pirat, Feuerwehr, Koch, Arzt, Polizist |
| Orte | Haus, Zelt, Schule, Strand, Brücke |
| Freizeit | Gitarre, Kamera, Drache (Spielzeug), Ball, Schaukel |
| Haushalt | Bett, Stuhl, Tasse, Lampe, Tisch, Topf |
| Fantasie | Roboter, Gespenst, Schneemann, Zauberer |

**Format (JSON-Datei `words_de.json`, vom `WordProvider` geladen):**

```json
[
  { "wordId": "w001", "text": "Katze",  "category": "Tiere",       "difficulty": "Easy" },
  { "wordId": "w002", "text": "Pizza",  "category": "Essen",       "difficulty": "Easy" },
  { "wordId": "w003", "text": "Fahrrad","category": "Fahrzeuge",   "difficulty": "Medium" }
]
```
(`normalizedText` wird beim Laden automatisch via `Normalize(text)` ergänzt.)

---

## 12. Bewusst NICHT im MVP

Farben · Teammodus · Chaoskarten · Online-Server · Accounts · Werbung · In-App-Käufe · aufwendige Animationen · eigene Begriffe · Bild-Upload · Sprach-/Textchat · Host-Migration · Ranglisten/Avatare.

Die Architektur lässt diese Erweiterungen aber zu (z. B. `ToolType` um Farben erweiterbar, Protokoll um neue `type`-Werte, `GameRoom` um `mode`).
