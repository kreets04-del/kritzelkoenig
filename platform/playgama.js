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
  // WANN eine Werbepause passt, entscheidet das Spiel selbst
  // (werbestelleErlaubt() in index.html) - dort kennt man Rundenzahl und
  // Spielverlauf. Hier geht es nur noch darum, OB die Plattform gerade eine
  // Anzeige liefern kann. Die Regel stand frueher doppelt, hier und im Spiel;
  // das waere mit der Zeit auseinandergelaufen.

  function darfWerbung(name) {
    if (!PG.bereit || PG.werbungLaeuft) return false;
    // Meldet die Plattform, dass sie keine Interstitials kann, gar nicht erst fragen.
    var kann = versuche(function () { return PG.bridge.advertisement.isInterstitialSupported; });
    if (kann === false) return false;
    // Das SDK gibt einen eigenen Mindestabstand vor (Sekunden). Unserer ist
    // strenger; falls die Plattform mehr verlangt, gilt ihrer.
    var sdkAbstand = versuche(function () { return PG.bridge.advertisement.minimumDelayBetweenInterstitial; });
    var abstand = MIN_ABSTAND_MS;
    if (typeof sdkAbstand === 'number' && sdkAbstand * 1000 > abstand) abstand = sdkAbstand * 1000;
    if (Date.now() - PG.letzteWerbung < abstand) return false;
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

  // ---------- Advanced Banners ----------
  // Das Spiel meldet ueber KK_PORTAL_HOOKS.bannerZone nur, in welcher Zone es
  // gerade ist ('menu', 'lobby', 'round_break') oder null fuer "kein Banner".
  // Alles Weitere passiert hier.
  //
  // Aussehen und Position stehen NICHT im Code, sondern in
  // playgama-bridge-config.json unter advertisement.advancedBanners. Dort ist
  // je Zone hinterlegt, wo der Banner sitzt und ab welcher Bildschirmgroesse -
  // ist eine Zone dort nicht deklariert, passiert stillschweigend nichts.
  //
  // Zwei Dinge nimmt die Bridge einem ab: Sie blendet Banner waehrend eines
  // Interstitials selbst aus und danach wieder ein, und sie rechnet bei
  // Drehung oder Groessenaenderung die Lage neu aus.
  var DEBUG_BANNER = false;   // true -> jede Bannerentscheidung in die Konsole
  PG.bannerZone = null;

  function bannerLog(text) {
    if (DEBUG_BANNER) log('[Banner] ' + text);
  }
  PG.bannerMoeglich = function () {
    return !!versuche(function () {
      return PG.bereit && PG.bridge.advertisement.isAdvancedBannersSupported === true;
    });
  };
  function bannerAus(grund) {
    if (PG.bannerZone === null) return;
    PG.bannerZone = null;
    versuche(function () { PG.bridge.advertisement.hideAdvancedBanners(); });
    bannerLog('aus - ' + grund);
  }
  function bannerZone(zone) {
    // Kein Portal, keine Unterstuetzung, kein Banner - und das Spiel merkt nichts.
    if (!PG.bannerMoeglich()) { bannerLog('uebersprungen - Plattform kann keine Advanced Banners'); return; }
    if (zone === PG.bannerZone) return;          // gleiche Zone: nicht neu anfordern
    if (!zone) { bannerAus('Zone ohne Banner'); return; }
    PG.bannerZone = zone;
    versuche(function () { PG.bridge.advertisement.showAdvancedBanners(zone); });
    bannerLog('an - ' + zone);
  }

  // Zustandsmeldungen der Plattform mitschreiben, damit ein Fehlschlag sichtbar
  // ist. 'failed' heisst meist: fuer diese Bildschirmgroesse ist nichts
  // hinterlegt, oder es gibt gerade keine Anzeige. Beides ist kein Fehler.
  function bannerHorchen() {
    versuche(function () {
      var e = PG.bridge.EVENT_NAME && PG.bridge.EVENT_NAME.ADVANCED_BANNERS_STATE_CHANGED;
      if (e && PG.bridge.advertisement.on) {
        PG.bridge.advertisement.on(e, function (zustand) { bannerLog('Zustand: ' + zustand); });
      }
    });
  }

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

  // ---------- Selbstauskunft ----------
  // In der Konsole des Portals  KK_DIAG()  eingeben. Das liefert in einem Rutsch
  // alles, was zur Fehlersuche noetig ist - ohne Entwicklerwissen.
  window.KK_DIAG = function () {
    function frag(tue, sonst) { try { var w = tue(); return w === undefined ? sonst : w; } catch (e) { return 'Fehler: ' + e.message; } }
    var b = window.bridge;
    var ton = document.getElementById('bgm');
    return {
      Paketstand: window.KK_PLAYGAMA_BUILD || 'unbekannt',
      Bridge: {
        geladen: !!b,
        initialisiert: PG.bereit,
        Plattform: frag(function () { return b.platform.id; }, '-'),
        TonErlaubt: frag(function () { return b.platform.isAudioEnabled; }, '-'),
        pausiert: frag(function () { return b.platform.isPaused; }, '-'),
        WerbungMoeglich: frag(function () { return b.advertisement.isInterstitialSupported; }, '-')
      },
      Ton: {
        SpielStumm: frag(function () { return S.muted; }, '-'),
        WerbungStumm: frag(function () { return AD.muted; }, '-'),
        gesperrt: frag(function () { return audioBlocked(); }, '-'),
        aufgeschlossen: frag(function () { return tonAufgeschlossen; }, '-'),
        AudioContext: frag(function () { return actx ? actx.state : 'noch keiner'; }, '-'),
        MusikLaeuft: ton ? !ton.paused : '-',
        MusikFehler: ton && ton.error ? ('Code ' + ton.error.code) : 'keiner',
        MusikQuelle: ton ? (ton.currentSrc || 'nicht geladen') : '-',
        Nutzergeste: frag(function () { return navigator.userActivation.hasBeenActive; }, '-')
      },
      Spiel: {
        Zustand: frag(function () { return S.state; }, '-'),
        Raum: frag(function () { return S.roomCode; }, '-'),
        Sprache: frag(function () { return S.lang; }, '-'),
        Backend: window.API_BASE || '(gleiche Adresse)'
      }
    };
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

  // ACHTUNG: Die Bridge hat KEIN bridge.game. Ton-, Pause- und Sichtbarkeits-
  // Ereignisse haengen an bridge.platform. Ein Zuhoerer an der falschen Stelle
  // wirft nur intern und wird stillschweigend geschluckt - die Anzeige laeuft
  // dann mit Spielton weiter, und genau das ist ein Ablehnungsgrund bei Playgama.
  function hoerAufPlattform() {
    var EN = PG.bridge.EVENT_NAME || {};
    var p = PG.bridge.platform;
    if (!p || typeof p.on !== 'function') { log('platform.on fehlt - keine Ton-/Pausenereignisse'); return; }

    function binde(name, tue) {
      if (!name) return false;
      var ok = versuche(function () { p.on(name, tue); return true; });
      log('Ereignis verbunden', name + (ok ? '' : ' FEHLGESCHLAGEN'));
      return !!ok;
    }

    // Plattform schaltet den Ton stumm.
    binde(EN.AUDIO_STATE_CHANGED, function (zustand) {
      if (zustand === 'muted' || zustand === false) tonAus(); else tonAn();
    });
    // Plattform pausiert das Spiel.
    binde(EN.PAUSE_STATE_CHANGED, function (zustand) {
      if (zustand === 'paused' || zustand === true) { tonAus(); if (PG.spielLaeuft) { PG.spielLaeuft = false; PG._warLaufend = true; melde('level_paused'); } }
      else { tonAn(); if (PG._warLaufend) { PG._warLaufend = false; PG.spielLaeuft = true; melde('level_started'); } }
    });
    // Fenster/Tab nicht mehr sichtbar - Playgama prueft ausdruecklich, dass der
    // Ton auch dann schweigt ("screen is minimized").
    binde(EN.VISIBILITY_STATE_CHANGED, function (zustand) {
      if (zustand === 'hidden') tonAus(); else tonAn();
    });
  }

  // ---------- Fortschritt ueber die Bridge sichern ----------
  // Playgama verlangt ausdruecklich: "Save and load progress through Storage -
  // never use localStorage directly." Das Spiel liest seine Einstellungen aber
  // beim Start synchron, und bridge.storage ist asynchron. Deshalb bleibt
  // localStorage der schnelle lokale Zwischenspeicher, und diese Schicht spiegelt
  // die Werte zusaetzlich in die Bridge: beim Start von dort lesen, bei jeder
  // Aenderung dorthin schreiben. Damit liegt der Fortschritt dort, wo die
  // Plattform ihn erwartet, ohne den synchronen Start des Spiels umzubauen.
  var GESICHERT = ['kk_name', 'kk_lang', 'kk_mute', 'kritzelkoenig_format_v1', 'kritzelkoenig_tutorial_hidden_v1'];

  // ACHTUNG, hier lag ein Aufhaenger: bridge.storage.set() schreibt bei Playgama
  // seinerseits ueber window.localStorage.setItem - also in genau die Funktion,
  // die wir unten abfangen. Ohne Sperre ruft sich beides gegenseitig auf und der
  // Hauptfaden steht. Zu sehen war das als "Seite reagiert nicht", sobald ein
  // gespiegelter Schluessel geschrieben wurde - zum Beispiel beim Klick auf
  // "Los geht's", der das gewaehlte Format sichert.
  // Zwei Riegel, weil einer nicht reicht:
  //   imSpiegel     - faengt den unmittelbaren Rueckruf ab (synchrones set()).
  //   letzteWerte   - faengt ihn auch dann ab, wenn die Bridge erst spaeter
  //                   zurueckschreibt: derselbe Wert wird kein zweites Mal
  //                   gespiegelt, damit kein Hin und Her entstehen kann.
  var imSpiegel = false;
  var letzteWerte = {};

  function spiegelSchreiben(schluessel, wert) {
    if (imSpiegel) return;
    if (!PG.bereit || GESICHERT.indexOf(schluessel) < 0) return;
    var text = String(wert);
    if (letzteWerte[schluessel] === text) return;
    letzteWerte[schluessel] = text;
    imSpiegel = true;
    try {
      versuche(function () {
        var s = PG.bridge.storage;
        if (s && typeof s.set === 'function') s.set(schluessel, text);
      });
    } finally {
      imSpiegel = false;
    }
  }

  var abgefangen = false;
  function schreibenAbfangen() {
    // Nur die eigenen kk-Schluessel werden gespiegelt, alles andere bleibt
    // unberuehrt. Der urspruengliche Aufruf laeuft immer zuerst.
    if (abgefangen) return;   // zweimal abfangen wuerde die Kette verdoppeln
    abgefangen = true;
    versuche(function () {
      var original = window.localStorage.setItem.bind(window.localStorage);
      window.localStorage.setItem = function (k, v) {
        original(k, v);
        spiegelSchreiben(k, v);
      };
    });
  }

  function gesichertesLaden() {
    var s = versuche(function () { return PG.bridge.storage; });
    if (!s || typeof s.get !== 'function') return Promise.resolve();
    return Promise.resolve(versuche(function () { return s.get(GESICHERT); }))
      .then(function (werte) {
        if (!werte) return;
        // get() liefert je nach Plattform ein Feld in derselben Reihenfolge.
        var liste = Array.isArray(werte) ? werte : GESICHERT.map(function (k) { return werte[k]; });
        var uebernommen = [];
        GESICHERT.forEach(function (k, i) {
          var v = liste[i];
          if (v === null || v === undefined || v === '') return;
          // Nicht ueberschreiben, was auf diesem Geraet schon steht - sonst
          // springt eine gerade getroffene Wahl beim naechsten Start zurueck.
          var da = versuche(function () { return window.localStorage.getItem(k); });
          if (da !== null && da !== undefined) return;
          letzteWerte[k] = String(v);   // kommt von dort - nicht dorthin zurueckspiegeln
          versuche(function () { window.localStorage.setItem(k, String(v)); });
          uebernommen.push(k);
        });
        if (uebernommen.length) log('aus der Plattform uebernommen', uebernommen.join(', '));
      })
      .catch(function () {});
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
    bannerZone:    bannerZone,
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
    log('Paketstand ' + (window.KK_PLAYGAMA_BUILD || 'unbekannt') + ' - Bridge wird gestartet');
    b.initialize().then(function () {
      PG.bereit = true;
      // Diese eine Zeile beantwortet die wichtigste Frage: Erkennt die Bridge das
      // Portal, oder faellt sie auf "mock" zurueck? Bei "mock" gehen game_ready
      // und alle Ton-Ereignisse ins Leere.
      log('Bridge bereit', 'Plattform=' + versuche(function () { return b.platform.id; })
        + ' | Ton erlaubt=' + versuche(function () { return b.platform.isAudioEnabled; })
        + ' | pausiert=' + versuche(function () { return b.platform.isPaused; })
        + ' | Werbung moeglich=' + versuche(function () { return b.advertisement.isInterstitialSupported; }));
      hoerAufPlattform();
      schreibenAbfangen();
      // Erst den gesicherten Stand holen, dann die Sprache setzen - sonst
      // ueberschriebe die Plattformsprache eine frueher getroffene Wahl.
      // game_ready darf unter keinen Umstaenden ausbleiben - fehlt es, gilt das
      // Spiel bei Playgama als nicht startbereit. Antwortet der Speicher einer
      // Partnerplattform nicht, geht es nach zwei Sekunden ohne ihn weiter.
      var fertig = false;
      var mitFrist = Promise.race([
        gesichertesLaden().then(function () { fertig = true; }),
        new Promise(function (r) {
          setTimeout(function () { if (!fertig) log('Speicher antwortet nicht - weiter ohne'); r(); }, 2000);
        })
      ]);
      return mitFrist.then(function () {
        uebernehmeSprache();
        bannerHorchen();
        melde('game_ready');
        log('game_ready gesendet');
        // Die Bridge ist erst jetzt bereit; das Spiel hat seine Zone aber
        // vorher schon gemeldet. Einmal nachziehen, sonst fehlt der erste Banner.
        versuche(function () {
          if (typeof aktualisiereBannerZone === 'function') { PG.bannerZone = null; aktualisiereBannerZone(); }
        });
      });
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
