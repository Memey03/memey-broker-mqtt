// CARA DEPLOY KE VERCEL:
// 1. npm create vite@latest iot-dashboard -- --template react
// 2. cd iot-dashboard
// 3. npm install mqtt lucide-react
// 4. Ganti src/App.jsx dengan file ini
// 5. Buat vite.config.ts dengan isi:
//    import { defineConfig } from 'vite'
//    import react from '@vitejs/plugin-react'
//    export default defineConfig({
//      plugins: [react()],
//      optimizeDeps: { include: ['mqtt'] },
//      define: { global: 'globalThis' }
//    })
// 6. npm run build
// 7. vercel deploy — atau push ke GitHub lalu connect di vercel.com

import React, { useState, useEffect, useRef, useCallback } from 'react';
import mqtt from 'mqtt';
import { Thermometer, Droplets, Mic, MicOff, Activity } from 'lucide-react';

export default function App() {
  const mqttClients = useRef({ broker1: null, broker2: null, broker3: null });

  const [brokerStatus, setBrokerStatus] = useState({
    broker1: 'disconnected',
    broker2: 'disconnected',
    broker3: 'disconnected'
  });
  const [relayState, setRelayState]     = useState([false, false, false, false]);
  const [sensor, setSensor]             = useState({ suhu: '--', kelembapan: '--' });
  const [logs, setLogs]                 = useState([]);
  const [isListening, setIsListening]   = useState(false);
  const [transcript, setTranscript]     = useState('');
  const [voiceStatus, setVoiceStatus]   = useState('Siap');
  const [sensorPulse, setSensorPulse]   = useState(false);

  const logsEndRef   = useRef(null);
  const recognitionRef = useRef(null);

  // Gunakan ref untuk sensor agar processCommand selalu baca nilai terbaru
  // tanpa perlu re-create recognition object setiap kali sensor berubah
  const sensorRef = useRef(sensor);
  useEffect(() => { sensorRef.current = sensor; }, [sensor]);

  // ─── Log helper ───────────────────────────────────────────
  const addLog = useCallback((msg) => {
    const time = new Date().toLocaleTimeString('id-ID');
    setLogs(prev => [...prev, `[${time}] ${msg}`].slice(-50));
  }, []);

  // ─── TTS ──────────────────────────────────────────────────
  const speak = useCallback((text) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel(); // batalkan antrian sebelumnya
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'id-ID';
    window.speechSynthesis.speak(utt);
  }, []);

  // ─── Publish ke semua broker ──────────────────────────────
  const publishAll = useCallback((payload) => {
    const topic = 'esp32/relay/cmd';
    let sent = 0;
    Object.values(mqttClients.current).forEach(client => {
      if (client && client.connected) {
        client.publish(topic, payload);
        sent++;
      }
    });

    if (sent > 0) {
      addLog(`Perintah: ${payload} → dikirim ke ${sent} broker`);
      // Update UI relay state
      if (payload === 'ON')  { setRelayState([true,  true,  true,  true]);  return; }
      if (payload === 'OFF') { setRelayState([false, false, false, false]); return; }
      if (payload === 'POLA1' || payload === 'POLA2' || payload === 'STOP') return;
      const match = payload.match(/^R([1-4]):(ON|OFF)$/);
      if (match) {
        const idx    = parseInt(match[1]) - 1;
        const active = match[2] === 'ON';
        setRelayState(prev => {
          const next = [...prev];
          next[idx] = active;
          return next;
        });
      }
    } else {
      addLog(`⚠ Gagal kirim: tidak ada broker terhubung`);
    }
  }, [addLog]);

  // ─── Proses perintah suara ────────────────────────────────
  // FIX UTAMA: gunakan sensorRef bukan sensor langsung,
  // sehingga fungsi ini tidak perlu di-recreate setiap sensor berubah.
  // Keyword matching diperluas agar toleran terhadap variasi ucapan.
  const processCommand = useCallback((cmd) => {
    const t = cmd.toLowerCase().trim();
    addLog(`Voice: "${cmd}"`);

    // Helper angka kata → digit
    const norm = t
      .replace(/\bsatu\b/g,  '1')
      .replace(/\bdua\b/g,   '2')
      .replace(/\btiga\b/g,  '3')
      .replace(/\bempat\b/g, '4');

    // ── Lampu individual ─────────────────────────────────────
    // Pola: (nyala|hidupkan|aktifkan|on) lampu (1-4)
    // Pola: (mati|matikan|off) lampu (1-4)
    const onMatch  = norm.match(/(?:nyala(?:kan)?|hidupkan|aktifkan|\bon\b)\s+lampu\s+([1-4])/);
    const offMatch = norm.match(/(?:mati(?:kan)?|matikan|padamkan|\boff\b)\s+lampu\s+([1-4])/);
    const lampuMatiReverse = norm.match(/lampu\s+([1-4])\s+(?:mati|off)/);

    if (onMatch) {
      const n = onMatch[1];
      publishAll(`R${n}:ON`);
      speak(`Lampu ${n} dinyalakan`);
      return;
    }
    if (offMatch) {
      const n = offMatch[1];
      publishAll(`R${n}:OFF`);
      speak(`Lampu ${n} dimatikan`);
      return;
    }
    if (lampuMatiReverse) {
      const n = lampuMatiReverse[1];
      publishAll(`R${n}:OFF`);
      speak(`Lampu ${n} dimatikan`);
      return;
    }

    // ── Semua lampu ───────────────────────────────────────────
    if (/(semua|all).*(nyala|hidup|on)|(nyala|hidup|on).*(semua|all)|hidupkan semua|nyalakan semua/.test(norm)) {
      publishAll('ON');
      speak('Semua lampu dinyalakan');
      return;
    }
    if (/(semua|all).*(mati|off)|(mati|off).*(semua|all)|matikan semua|padamkan semua/.test(norm)) {
      publishAll('OFF');
      speak('Semua lampu dimatikan');
      return;
    }

    // ── Pola ─────────────────────────────────────────────────
    if (/pola.*(1|satu|pertama)|aktifkan pola 1|nyalakan pola 1/.test(norm)) {
      publishAll('POLA1');
      speak('Pola satu diaktifkan');
      return;
    }
    if (/pola.*(2|dua|kedua)|aktifkan pola 2|nyalakan pola 2/.test(norm)) {
      publishAll('POLA2');
      speak('Pola dua diaktifkan');
      return;
    }
    if (/stop|henti|berhenti/.test(norm)) {
      publishAll('STOP');
      speak('Pola dihentikan');
      return;
    }

    // ── Info suhu ─────────────────────────────────────────────
    if (/suhu|temperatur|panas|dingin|lembap|kelembap/.test(norm)) {
      const { suhu, kelembapan } = sensorRef.current;
      const s = suhu       !== '--' ? suhu       : 'tidak diketahui';
      const k = kelembapan !== '--' ? kelembapan : 'tidak diketahui';
      speak(`Suhu saat ini ${s} derajat celsius, kelembapan ${k} persen`);
      addLog(`Info sensor: Suhu ${s}°C, Kelembapan ${k}%`);
      return;
    }

    // ── Tidak dikenal ─────────────────────────────────────────
    speak('Perintah tidak dikenali, coba lagi');
    addLog(`Perintah tidak dikenal: "${cmd}"`);
  }, [publishAll, addLog, speak]); // sensorRef tidak perlu di deps karena ref

  // ─── Setup Speech Recognition ─────────────────────────────
  // FIX: recognition dibuat SEKALI, pakai ref untuk processCommand
  // agar tidak terjadi stale closure
  const processCommandRef = useRef(processCommand);
  useEffect(() => { processCommandRef.current = processCommand; }, [processCommand]);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setVoiceStatus('Browser tidak mendukung Voice Command. Gunakan Chrome.');
      return;
    }

    const recognition       = new SR();
    recognition.lang        = 'id-ID';
    recognition.continuous  = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
      setVoiceStatus('Mendengarkan...');
    };

    recognition.onresult = (event) => {
      const text = event.results[event.resultIndex][0].transcript;
      setTranscript(text);
      setVoiceStatus('Memproses...');
      // Panggil via ref → selalu versi terbaru, tidak stale
      processCommandRef.current(text);
    };

    recognition.onerror = (e) => {
      console.error('SR error:', e.error);
      setIsListening(false);
      setVoiceStatus(e.error === 'no-speech' ? 'Tidak ada suara, coba lagi' : 'Error, coba lagi');
      setTimeout(() => setVoiceStatus('Siap'), 2500);
    };

    recognition.onend = () => {
      setIsListening(false);
      setVoiceStatus(prev => (prev === 'Memproses...' ? 'Siap' : prev));
      setTimeout(() => setVoiceStatus('Siap'), 1500);
    };

    recognitionRef.current = recognition;
    // Tidak ada cleanup — recognition hanya satu instance sepanjang hidup komponen
  }, []); // [] — dibuat SEKALI, tidak bergantung processCommand

  const toggleListen = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      setTranscript('');
      try { recognitionRef.current.start(); } catch (e) { console.error(e); }
    }
  };

  // ─── Setup MQTT ───────────────────────────────────────────
  useEffect(() => {
    const uid = (p) => p + Math.random().toString(36).substr(2, 9);

    const configs = [
      {
        id: 'broker1',
        url: 'wss://test.mosquitto.org:8081',
        opts: { clientId: uid('web_b1_') }
      },
      {
        id: 'broker2',
        url: 'ws://broker.mqtt.cool:8083',
        opts: { clientId: uid('web_b2_') }
      },
      {
        id: 'broker3',
        url: 'wss://mqtt.flespi.io:443',
        opts: {
          clientId: uid('web_b3_'),
          username: 'r6urKWnSiwA8lUQIq9mYKxWd9g7ktNWGfZIJU1h1CyS3IOqbeCDtSrfD9WIXyAKA',
          password: ''
        }
      }
    ];

    configs.forEach(({ id, url, opts }) => {
      setBrokerStatus(prev => ({ ...prev, [id]: 'connecting' }));
      let client;
      try {
        client = mqtt.connect(url, opts);
        mqttClients.current[id] = client;

        client.on('connect', () => {
          setBrokerStatus(prev => ({ ...prev, [id]: 'connected' }));
          addLog(`${id} terhubung (${url})`);
          client.subscribe('esp32/sensor/status');
          client.subscribe('esp32/relay/cmd');
        });

        client.on('reconnect', () => {
          setBrokerStatus(prev => ({ ...prev, [id]: 'connecting' }));
        });

        client.on('close', () => {
          setBrokerStatus(prev => ({ ...prev, [id]: 'disconnected' }));
        });

        client.on('error', (err) => {
          console.error(`MQTT ${id}:`, err.message);
        });

        client.on('message', (topic, msg) => {
          if (topic === 'esp32/sensor/status') {
            try {
              const data = JSON.parse(msg.toString());
              if (data.suhu !== undefined) {
                setSensor({ suhu: data.suhu, kelembapan: data.kelembapan });
                setSensorPulse(true);
                setTimeout(() => setSensorPulse(false), 600);
                addLog(`Sensor: Suhu ${data.suhu}°C, Kelembapan ${data.kelembapan}%`);
              }
            } catch (_) {}
          }
        });
      } catch (e) {
        setBrokerStatus(prev => ({ ...prev, [id]: 'disconnected' }));
        addLog(`Gagal inisialisasi ${id}`);
      }
    });

    return () => {
      Object.values(mqttClients.current).forEach(c => c?.end(true));
    };
  }, [addLog]);

  // Auto-scroll log
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // ─── UI helpers ───────────────────────────────────────────
  const dotColor = (s) =>
    s === 'connected'  ? 'bg-green-400'  :
    s === 'connecting' ? 'bg-yellow-400' : 'bg-red-400';

  const brokerNames = ['MOSQUITTO', 'MQTT.COOL', 'FLESPI'];

  return (
    <div className="flex flex-col min-h-screen w-full bg-[#F0F4F8] text-slate-800 font-sans">

      {/* ── HEADER ── */}
      <header className="bg-blue-600 text-white px-4 py-3 flex justify-between items-center shadow-lg shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight">IoT Control Dashboard</h1>
          <p className="text-blue-200 text-[11px] font-medium uppercase tracking-wider">Multi-Broker MQTT System</p>
        </div>
        <div className="flex gap-2">
          {['broker1','broker2','broker3'].map((id, i) => (
            <div key={id} className="bg-white/10 border border-white/20 rounded-lg px-2 py-1 flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${dotColor(brokerStatus[id])}`}></span>
              <span className="text-[10px] font-semibold hidden sm:inline">{brokerNames[i]}</span>
            </div>
          ))}
        </div>
      </header>

      {/* ── MAIN ── */}
      <main className="flex flex-col lg:flex-row flex-1 p-4 gap-4 max-w-[1200px] mx-auto w-full">

        {/* Kolom kiri */}
        <div className="flex flex-col gap-4 w-full lg:w-3/5">

          {/* Sensor */}
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Suhu Ruangan', value: sensor.suhu,       unit: '°C', icon: <Thermometer className="w-7 h-7 text-blue-600" /> },
              { label: 'Kelembapan',   value: sensor.kelembapan, unit: '%',  icon: <Droplets     className="w-7 h-7 text-blue-600" /> },
            ].map(({ label, value, unit, icon }) => (
              <div key={label}
                className={`bg-white p-4 rounded-xl shadow-md border border-blue-100 flex items-center gap-3 transition-all duration-300
                  ${sensorPulse ? 'ring-2 ring-blue-300 bg-blue-50 scale-[1.02]' : ''}`}>
                <div className="bg-blue-100 p-2.5 rounded-full shrink-0">{icon}</div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">{label}</p>
                  <h2 className="text-2xl font-black text-slate-800">
                    {value} <span className="text-base text-slate-400 font-normal">{unit}</span>
                  </h2>
                </div>
              </div>
            ))}
          </div>

          {/* Relay grid */}
          <div className="grid grid-cols-2 gap-4">
            {[0,1,2,3].map(idx => {
              const on = relayState[idx];
              return (
                <button key={idx}
                  onClick={() => publishAll(`R${idx+1}:${on ? 'OFF' : 'ON'}`)}
                  className={`relative p-5 rounded-xl border-2 transition-all duration-300 shadow-md flex flex-col justify-between
                    outline-none focus:ring-4 focus:ring-blue-100 text-left min-h-[110px]
                    ${on ? 'bg-blue-50 border-blue-600 scale-[1.02]' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
                  <span className={`absolute top-3 right-3 text-[10px] font-bold uppercase
                    ${on ? 'text-blue-600' : 'text-slate-400'}`}>
                    {on ? 'AKTIF' : 'MATI'}
                  </span>
                  <h3 className="font-bold text-lg mt-1 text-slate-800">Lampu {idx+1}</h3>
                  <div className="flex justify-end mt-2">
                    <div className={`w-12 h-7 rounded-full flex items-center px-1 transition-colors ${on ? 'bg-blue-600' : 'bg-slate-200'}`}>
                      <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`}></div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Pola & master */}
          <div className="bg-white p-4 rounded-xl shadow-md border border-blue-100">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase mb-3">Pola & Kontrol Massal</h3>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => publishAll('POLA1')} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 active:scale-95 transition-all">POLA 1 — Kiri→Kanan</button>
              <button onClick={() => publishAll('POLA2')} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 active:scale-95 transition-all">POLA 2 — Strobe</button>
              <button onClick={() => publishAll('STOP')}  className="px-3 py-2 bg-red-100 text-red-600 rounded-lg text-xs font-bold border border-red-200 hover:bg-red-200 active:scale-95 transition-all">STOP</button>
              <button onClick={() => publishAll('ON')}    className="px-3 py-2 bg-slate-800 text-white rounded-lg text-xs font-semibold hover:bg-slate-700 ml-auto active:scale-95 transition-all">SEMUA ON</button>
              <button onClick={() => publishAll('OFF')}   className="px-3 py-2 bg-slate-200 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-300 active:scale-95 transition-all">SEMUA OFF</button>
            </div>
          </div>
        </div>

        {/* Kolom kanan */}
        <div className="flex flex-col gap-4 w-full lg:w-2/5">

          {/* Voice panel */}
          <div className="bg-white p-6 rounded-xl shadow-md border border-blue-100 flex flex-col items-center gap-4 min-h-[180px]">
            <div className="relative">
              {isListening && (
                <div className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-25 scale-150"></div>
              )}
              <button onClick={toggleListen}
                className={`relative w-16 h-16 rounded-full shadow-lg flex items-center justify-center text-white border-4 border-white transition-all
                  ${isListening ? 'bg-red-500 scale-110' : 'bg-blue-500 hover:scale-105'}`}>
                {isListening
                  ? <Mic    className="w-7 h-7" />
                  : <MicOff className="w-7 h-7" />}
              </button>
            </div>
            <div className="text-center w-full">
              <p className={`font-bold text-xs uppercase tracking-widest mb-2
                ${isListening ? 'text-red-500 animate-pulse' : 'text-slate-400'}`}>
                {voiceStatus}
              </p>
              {transcript && (
                <div className="bg-slate-50 border border-slate-200 p-2.5 rounded-lg max-w-xs mx-auto">
                  <p className="text-slate-600 italic text-sm">"{transcript}"</p>
                </div>
              )}
              {/* Panduan singkat */}
              <div className="mt-3 text-[10px] text-slate-400 text-left space-y-0.5">
                <p>🎤 <b>Contoh perintah:</b></p>
                <p>"Nyalakan lampu 1" · "Matikan lampu 3"</p>
                <p>"Hidupkan semua" · "Matikan semua"</p>
                <p>"Pola satu" · "Pola dua" · "Stop"</p>
                <p>"Berapa suhu" · "Info suhu"</p>
              </div>
            </div>
          </div>

          {/* Log */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 flex flex-col flex-1 overflow-hidden min-h-[250px]">
            <div className="bg-slate-200 px-4 py-2 flex justify-between items-center shrink-0">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest flex items-center gap-1.5">
                <Activity size={13} className="text-slate-500" /> Log Aktivitas
              </span>
              <span className="text-[10px] bg-slate-400 text-white px-2 py-0.5 rounded-full animate-pulse">LIVE</span>
            </div>
            <div className="p-3 flex flex-col gap-1.5 font-mono text-[11px] text-slate-600 overflow-y-auto flex-1">
              {logs.length === 0
                ? <p className="text-slate-400 text-center mt-6">Belum ada aktivitas</p>
                : logs.map((log, i) => {
                    const l = log.toLowerCase();
                    const color =
                      l.includes('gagal') || l.includes('error') ? 'text-red-600 font-bold' :
                      l.includes('sensor:')                       ? 'text-blue-500 font-semibold' :
                      l.includes('perintah:')                     ? 'text-slate-800' :
                      l.includes('voice:')                        ? 'text-indigo-600 italic' :
                      l.includes('terhubung')                     ? 'text-green-600 font-semibold' : '';
                    return (
                      <div key={i} className="border-b border-slate-100 pb-1 last:border-0">
                        <span className={color}>{log}</span>
                      </div>
                    );
                  })
              }
              <div ref={logsEndRef} />
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
