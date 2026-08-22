/* Kritzelkoenig - Playgama-Schicht
   ---------------------------------------------------------------------------
   Alles Playgama-Spezifische steht in dieser Datei. Der Spielcode in index.html
   kennt Playgama nicht; er spricht nur ueber zwei neutrale Anschluesse:

     window.KK_AD_PROVIDER      -> { show(type,name) : Promise<boolean> }
     window.KK_setPortalLanguage(code)

   Diese Datei wird NUR im Playgama-Build eingebunden (tools/build-playgama.js).
   Y8- und CrazyGames-Build enthalten sie nicht.

   Grundregel aus der Playgama-Vorgabe: Faellt eine Funktion auf einer
   Partnerplattform aus, laeuft das Spiel trotzdem sauber weiter. Deshalb ist
   hier jeder einzelne Aufruf gekapselt und jeder Rueckgabewert optional.
*/
'use strict';
(function () {
  var PG = {
    bereit: false,          // Bridge initialisiert?
    bridge: null,
    werbungLaeuft: false,
    letzteWerbung: 0,       // Zeitstempel der letzten gezeigten Anzeige
    spielLaeuft: false
  };
  window.KK_PLAYGAMA = PG;

  // Mindestabstand zwischen zwei Interstitials. Playgama erzwingt selbst ein
  // Intervall; wir halten zusaetzlich Abstand, damit ein Spieler in einer
  // schnellen Partie nicht nach jeder Runde eine Anzeige sieht.
  var MIN_ABSTAND_MS = 3 * 60 * 1000;
  // Nach so langer Zeit ohne Rueckmeldung geben wir auf und lassen weiterspielen.
  var MAX_WARTE_MS = 25000;

  function log(text, zusatz) {
    try { console.log('[Playgama] ' + text + (zusatz ? ' - ' + zusatz : '')); } catch (e) {}
  }
  // Jeder Bridge-Zugriff durch diesen Trichter: fehlt die Funktion auf einer
  // Partnerplattform, gibt es undefined statt einer Ausnahme.
  function versuche(was) {
    try { return was(); } catch (e) { return undefined; }
  }

  // ---------- Lebenszeichen an die Plattform ----------
  // sendMessage ist auf manchen Partnerplattformen ein No-Op. Das ist in Ordnung.
  function melde(name) {
    if (!PG.bereit) return;   // vor initialize() nimmt die Bridge nichts an
    versuche(function () {
      var p = PG.bridge && PG.bridge.platform;
      if (p && typeof p.sendMessage === 'function') p.sendMessage(name);
    });
  }

  // ---------- Ton und Pause ----------
  // Waehrend einer Anzeige muss der Spielton aus sein. Das Spiel regelt das
  // ueber adAudioOff()/adAudioOn(); beide liegen in index.html.
  function tonAus() { versuche(function () { if (typeof adAudioOff === 'function') adAudioOff(); }); }
  function tonAn()  { versuche(function () { if (typeof adAudioOn  === 'function') adAudioOn();  }); }

  // ---------- Interstitial ----------
  // Die Playgama-Vorgabe verbietet Werbung waehrend des Zeichnens, waehrend des
  // Ratens, bei laufendem Timer und direkt beim Start. Erlaubt sind natuerliche
  // Pausen. Diese Liste entscheidet, welche Aufrufstelle durchgelassen wird.
  var ERLAUBT = {
    'round-break': true,     // Rundenpause: alle Spieler warten ohnehin
    'game-over': true,       // Partie zu Ende
    'back-to-menu': true,    // zurueck ins Menue
    'game-start': false      // ausdruecklich NICHT: kein Interstitial beim Start
  };

  function darfWerbung(name) {
    if (!PG.bereit || PG.werbungLaeuft) return false;
    if (ERLAUBT[name] !== true) return false;
    if (Date.now() - PG.letzteWerbung < MIN_ABSTAND_MS) return false;
    return true;
  }

  function zeigeInterstitial(type, name) {
    return new Promise(function (auf) {
      if (!darfWerbung(name)) {
        log('uebersprungen', name + ' (' + (PG.bereit ? 'zu frueh oder nicht vorgesehen' : 'Bridge nicht bereit') + ')');
        auf(false);
        return;
      }
      var ad = versuche(function () { return PG.bridge.advertisement; });
      if (!ad || typeof ad.showInterstitial !== 'function') { auf(false); return; }

      PG.werbungLaeuft = true;
      var fertig = false, wache = null, lief = false;
      // Lief die Partie beim Oeffnen der Anzeige wirklich? Nur dann muss danach
      // wieder level_started gemeldet werden. In der Rundenpause und nach der
      // Partie ist das Spiel ohnehin schon pausiert - eine zweite Meldung waere
      // gelogen und wuerde die Statistik der Plattform verfaelschen.
      var warLaufend = false;

      function schluss(gezeigt) {
        if (fertig) return;
        fertig = true;
        if (wache) clearTimeout(wache);
        abmelden();
        PG.werbungLaeuft = false;
        if (gezeigt) PG.letzteWerbung = Date.now();
        tonAn();
        if (warLaufend) { PG.spielLaeuft = true; melde('level_started'); }
        auf(!!gezeigt);
      }

      // Zustaende der Anzeige: 'opened' -> Ton aus, 'closed'/'failed'/'empty' -> weiter.
      var horcher = function (zustand) {
        log('Anzeigezustand', String(zustand));
        if (zustand === 'opened') {
          lief = true; tonAus();
          if (PG.spielLaeuft) { warLaufend = true; PG.spielLaeuft = false; melde('level_paused'); }
          return;
        }
        if (zustand === 'closed' || zustand === 'failed' || zustand === 'empty') schluss(lief);
      };
      var abmelden = function () {
        versuche(function () {
          var e = PG.bridge.EVENT_NAME && PG.bridge.EVENT_NAME.INTERSTITIAL_STATE_CHANGED;
          if (e && PG.bridge.advertisement.off) PG.bridge.advertisement.off(e, horcher);
        });
      };

      versuche(function () {
        var e = PG.bridge.EVENT_NAME && PG.bridge.EVENT_NAME.INTERSTITIAL_STATE_CHANGED;
        if (e && ad.on) ad.on(e, horcher);
      });

      // Notbremse: meldet die Plattform nichts zurueck, geht es trotzdem weiter.
      // Der Server bricht die Rundenpause nach 35 s ohnehin ab; wir bleiben darunter.
      wache = setTimeout(function () { log('keine Rueckmeldung - weiter'); schluss(lief); }, MAX_WARTE_MS);

      log('Interstitial angefragt', name);
      var r = versuche(function () { return ad.showInterstitial(name); });
      if (r && typeof r.catch === 'function') r.catch(function (err) { log('nicht verfuegbar', err && err.message); schluss(false); });
    });
  }

  // Das ist der einzige Anschluss, den index.html kennt.
  window.KK_AD_PROVIDER = { show: zeigeInterstitial };

  // ---------- Rewarded Ads: nur vorbereitet, noch nicht im Spiel verwendet ----------
  // Vorgabe Abschnitt 18: Infrastruktur bereitstellen, aber noch keine Belohnung
  // vergeben. Wer das spaeter nutzt, ruft KK_PLAYGAMA.zeigeRewarded() auf und
  // bekommt true nur dann, wenn die Anzeige wirklich bis zum Ende lief.
  PG.rewardedVerfuegbar = function () {
    return !!versuche(function () {
      var ad = PG.bridge && PG.bridge.advertisement;
      return PG.bereit && ad && typeof ad.showRewarded === 'function';
    });
  };
  PG.zeigeRewarded = function () {
    return new Promise(function (auf) {
      if (!PG.rewardedVerfuegbar() || PG.werbungLaeuft) { auf(false); return; }
      var ad = PG.bridge.advertisement;
      PG.werbungLaeuft = true;
      var fertig = false, belohnt = false, wache = null, warLaufend = false;
      function schluss() {
        if (fertig) return; fertig = true;
        if (wache) clearTimeout(wache);
        versuche(function () {
          var e = PG.bridge.EVENT_NAME && PG.bridge.EVENT_NAME.REWARDED_STATE_CHANGED;
          if (e && ad.off) ad.off(e, horcher);
        });
        PG.werbungLaeuft = false; tonAn();
        if (warLaufend) { PG.spielLaeuft = true; melde('level_started'); }
        auf(belohnt);
      }
      var horcher = function (zustand) {
        log('Rewarded', String(zustand));
        if (zustand === 'opened') {
          tonAus();
          if (PG.spielLaeuft) { warLaufend = true; PG.spielLaeuft = false; melde('level_paused'); }
          return;
        }
        if (zustand === 'rewarded') { belohnt = true; return; }
        if (zustand === 'closed' || zustand === 'failed' || zustand === 'empty') schluss();
      };
      versuche(function () {
        var e = PG.bridge.EVENT_NAME && PG.bridge.EVENT_NAME.REWARDED_STATE_CHANGED;
        if (e && ad.on) ad.on(e, horcher);
      });
      wache = setTimeout(schluss, MAX_WARTE_MS);
      var r = versuche(function () { return ad.showRewarded(); });
      if (r && typeof r.catch === 'function') r.catch(function () { schluss(); });
    });
  };

  // ---------- Start ----------
  function uebernehmeSprache() {
    var code = versuche(function () { return PG.bridge.platform.language; });
    if (!code) return;
    var gesetzt = versuche(function () {
      return typeof window.KK_setPortalLanguage === 'function' && window.KK_setPortalLanguage(code);
    });
    log('Plattformsprache', String(code) + (gesetzt ? ' - uebernommen' : ' - nicht uebernommen (eigene Wahl oder nicht unterstuetzt)'));
  }

  function hoerAufPlattform() {
    // Plattform schaltet den Ton stumm (z. B. Tab im Hintergrund).
    versuche(function () {
      var e = PG.bridge.EVENT_NAME && PG.bridge.EVENT_NAME.AUDIO_STATE_CHANGED;
      if (e && PG.bridge.game.on) PG.bridge.game.on(e, function (zustand) {
        if (zustand === 'muted') tonAus(); else tonAn();
      });
    });
    // Plattform pausiert das Spiel.
    versuche(function () {
      var e = PG.bridge.EVENT_NAME && PG.bridge.EVENT_NAME.PAUSE_STATE_CHANGED;
      if (e && PG.bridge.game.on) PG.bridge.game.on(e, function (zustand) {
        if (zustand === 'paused') { tonAus(); melde('level_paused'); }
        else { tonAn(); if (PG.spielLaeuft) melde('level_started'); }
      });
    });
  }

  // Das Spiel meldet selbst, wann eine Partie laeuft - damit level_started und
  // level_paused zur Wirklichkeit passen und nicht nur zur Werbung.
  PG.partieGestartet = function () { if (PG.spielLaeuft) return; PG.spielLaeuft = true; melde('level_started'); };
  PG.partieBeendet   = function () { if (!PG.spielLaeuft) return; PG.spielLaeuft = false; melde('level_paused'); };
  // Der zweite neutrale Anschluss: index.html ruft das ueber Platform.gameplayStart()
  // bzw. .gameplayStop() auf, ohne Playgama zu kennen.
  window.KK_PORTAL_HOOKS = {
    gameplayStart: PG.partieGestartet,
    gameplayStop:  PG.partieBeendet,
    loadingStart:  function () { melde('in_game_loading_started'); },
    loadingStop:   function () { melde('in_game_loading_stopped'); }
  };

  function start() {
    var b = window.bridge;
    if (!b || typeof b.initialize !== 'function') {
      log('Bridge nicht geladen - Spiel laeuft ohne Playgama-Funktionen weiter');
      return;
    }
    PG.bridge = b;
    // Vor initialize() darf nichts an die Plattform gehen - die Bridge meldet
    // sonst "Before using the SDK you must initialize it" in die Konsole.
    b.initialize().then(function () {
      PG.bereit = true;
      log('Bridge bereit');
      uebernehmeSprache();
      hoerAufPlattform();
      melde('game_ready');
    }).catch(function (err) {
      // Kein Abbruch: ohne Bridge fehlen nur Werbung und Plattformsprache.
      log('Initialisierung fehlgeschlagen', err && err.message);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
