'use client';

import { useState, useCallback, useRef } from 'react';
import { routeEmergency, type AgentDecision } from '@/app/actions/agentRouter';
import { sendWhatsappDispatch } from '@/app/actions/dispatchWhatsapp';
import { sendEmailDispatch } from '@/app/actions/dispatchEmail';

type Stage = 'idle' | 'analyzing' | 'querying' | 'dispatching' | 'done' | 'error';

const STAGE_ORDER: { key: Stage; log: string }[] = [
  { key: 'analyzing', log: 'reading report and assessing severity' },
  { key: 'querying', log: 'searching NGO network' },
  { key: 'dispatching', log: 'dispatching to responder' },
];

function BeaconIllustration() {
  return (
    <svg viewBox="0 0 400 320" className="w-full max-w-sm mx-auto" role="img" aria-label="A signal connecting your location to a responder">
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FF6B4A" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#FF6B4A" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="230" cy="120" r="150" fill="url(#glow)" />

      <path
        d="M110,230 C170,150 230,90 290,110"
        fill="none"
        stroke="#FFF6EE"
        strokeOpacity="0.55"
        strokeWidth="2"
        strokeDasharray="6 8"
      />

      <g className="motion-safe:animate-ping" style={{ transformOrigin: '290px 110px' }}>
        <circle cx="290" cy="110" r="14" fill="#FFB454" opacity="0.35" />
      </g>
      <circle cx="290" cy="110" r="8" fill="#FFB454" />
      <circle cx="290" cy="110" r="8" fill="none" stroke="#1B1035" strokeWidth="2" />
      <text x="290" y="80" textAnchor="middle" fill="#FFF6EE" fontSize="13" opacity="0.75">
        responder
      </text>

      <g transform="translate(110,230)">
        <path
          d="M0,-30 C16,-30 28,-18 28,-4 C28,16 0,40 0,40 C0,40 -28,16 -28,-4 C-28,-18 -16,-30 0,-30 Z"
          fill="#FF6B4A"
        />
        <circle cx="0" cy="-4" r="9" fill="#FFF6EE" />
      </g>
      <text x="110" y="286" textAnchor="middle" fill="#FFF6EE" fontSize="13" opacity="0.75">
        you
      </text>
    </svg>
  );
}

export default function CrisisIntakePage() {
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [decision, setDecision] = useState<AgentDecision | null>(null);
  const [dispatchStatus, setDispatchStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const captureLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setErrorMsg('Geolocation is not supported by this browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      (err) => {
        setErrorMsg(`Location error: ${err.message}`);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Please select an image file.');
      return;
    }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const clearPhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const readPhotoAsBase64 = (): Promise<{ base64: string; mediaType: string } | null> => {
    return new Promise((resolve) => {
      if (!photoFile) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const [, base64] = result.split(',');
        resolve({ base64, mediaType: photoFile.type });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(photoFile);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setDecision(null);
    setDispatchStatus(null);

    if (description.trim().length < 5) {
      setErrorMsg('Please describe the emergency in more detail.');
      return;
    }
    if (!phone.trim()) {
      setErrorMsg('Please enter a contact phone number.');
      return;
    }

    try {
      setStage('analyzing');
      const photoData = await readPhotoAsBase64();
      await new Promise((r) => setTimeout(r, 350));

      setStage('querying');
      const result = await routeEmergency({
        description,
        userPhone: phone,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        imageBase64: photoData?.base64 ?? null,
        imageMediaType: (photoData?.mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif') ?? null,
      });

      if (!result.success) {
        setErrorMsg(result.error);
        setStage('error');
        return;
      }

      setDecision(result.decision);
      setStage('dispatching');

      if (result.decision.urgency === 'Critical') {
        const waResult = await sendWhatsappDispatch(
          result.decision.selected_ngo_phone,
          result.decision.dispatch_message,
          phone
        );
        setDispatchStatus(
          waResult.success
            ? `Sent via WhatsApp to ${result.decision.selected_ngo_phone}`
            : `WhatsApp dispatch failed: ${waResult.detail}`
        );
      } else {
        if (!result.decision.selected_ngo_email) {
          setDispatchStatus(`No email on file for ${result.decision.selected_ngo_name} — nothing sent.`);
        } else {
          const emailResult = await sendEmailDispatch(
            result.decision.selected_ngo_email,
            result.decision.selected_ngo_name,
            result.decision.dispatch_message
          );
          setDispatchStatus(
            emailResult.success
              ? `Sent via email to ${result.decision.selected_ngo_email}`
              : `Email dispatch failed: ${emailResult.detail}`
          );
        }
      }

      setStage('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unexpected error.');
      setStage('error');
    }
  };

  const isBusy = stage === 'analyzing' || stage === 'querying' || stage === 'dispatching';
  const currentStageIndex = STAGE_ORDER.findIndex((s) => s.key === stage);

  return (
    <main className="min-h-screen bg-cream">
      {/* Hero */}
      <div className="bg-gradient-to-br from-night via-dusk to-dawn pb-24">
        <div className="max-w-3xl mx-auto px-5 pt-6 flex items-center justify-between">
          <span className="font-display text-lg text-cream">Crisis Router</span>
          <div className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 rounded-full ${isBusy ? 'bg-amber motion-safe:animate-pulse' : 'bg-confirm'}`}
              aria-hidden="true"
            />
            <span className="font-mono text-xs text-lavender">
              {isBusy ? 'processing' : 'ready'}
            </span>
          </div>
        </div>

        <div className="max-w-3xl mx-auto px-5 pt-10 grid md:grid-cols-2 gap-8 items-center">
          <div className="max-w-md">
            <h1 className="font-display text-4xl md:text-5xl text-cream leading-[1.1]">
              Help arrives faster
            </h1>
            <p className="mt-4 text-base text-lavender leading-relaxed">
              Tell us what&apos;s happening. An AI dispatcher reads your report, matches you to
              the right responder, and sends it — day or night.
            </p>
          </div>
          <BeaconIllustration />
        </div>
      </div>

      {/* Form card, floated over hero edge */}
      <div className="max-w-xl mx-auto px-5 -mt-14 pb-16">
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl shadow-night/10 p-6 space-y-5">
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-ink mb-1.5">
              What&apos;s happening
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isBusy}
              rows={4}
              placeholder="Found a dog with a badly injured leg near the bus stop, it can't walk..."
              className="w-full rounded-lg bg-cream/60 border border-lavender/40 px-3 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-dawn disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Photo (optional)</label>
            {!photoPreview ? (
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                disabled={isBusy}
                className="w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-dawn/10 file:px-3 file:py-1.5 file:text-sm file:text-dawn file:font-medium hover:file:bg-dawn/20 disabled:opacity-50"
              />
            ) : (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoPreview}
                  alt="Emergency scene"
                  className="w-full max-h-44 object-cover rounded-lg border border-lavender/30"
                />
                <button
                  type="button"
                  onClick={clearPhoto}
                  disabled={isBusy}
                  className="absolute top-2 right-2 bg-white/90 hover:bg-white text-ink text-xs px-2 py-1 rounded-full shadow disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-ink mb-1.5">
              Your phone number
            </label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={isBusy}
              placeholder="+15551234567"
              className="w-full rounded-lg bg-cream/60 border border-lavender/40 px-3 py-2.5 text-sm text-ink font-mono placeholder:text-muted placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-dawn disabled:opacity-50"
            />
          </div>

          <div>
            <button
              type="button"
              onClick={captureLocation}
              disabled={locating || isBusy}
              className="w-full flex items-center justify-between rounded-lg border border-lavender/40 bg-cream/60 px-3 py-2.5 text-sm text-ink hover:border-dawn transition-colors disabled:opacity-50"
            >
              <span>{locating ? 'Locating...' : 'Share my location'}</span>
              {coords && (
                <span className="font-mono text-xs text-muted">
                  {coords.lat.toFixed(3)}, {coords.lng.toFixed(3)}
                </span>
              )}
            </button>
          </div>

          <button
            type="submit"
            disabled={isBusy}
            className="w-full rounded-full bg-dawn hover:bg-dawn/90 transition-colors px-3 py-3.5 font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isBusy ? 'Processing' : 'Submit'}
          </button>
        </form>

        {isBusy && (
          <div className="mt-4 bg-night rounded-xl px-4 py-3 font-mono text-xs space-y-1.5">
            {STAGE_ORDER.map((s, i) => {
              const isDone = i < currentStageIndex;
              const isCurrent = i === currentStageIndex;
              return (
                <div
                  key={s.key}
                  className={isDone ? 'text-confirm' : isCurrent ? 'text-amber' : 'text-lavender/50'}
                >
                  {isDone ? '> ' : isCurrent ? '> ' : '  '}
                  {s.log}
                  {isCurrent && <span className="motion-safe:animate-pulse">_</span>}
                </div>
              );
            })}
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 bg-white border-l-4 border-alert rounded-xl px-4 py-3 text-sm text-ink shadow-sm">
            {errorMsg}
          </div>
        )}

        {decision && stage === 'done' && (
          <div
            className={`mt-4 bg-white rounded-xl shadow-lg shadow-night/5 border-l-4 p-5 space-y-3 ${
              decision.urgency === 'Critical' ? 'border-alert' : 'border-amber'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-display font-semibold text-lg text-ink leading-snug">
                {decision.selected_ngo_name}
              </h2>
              <span
                className={`shrink-0 text-xs font-mono px-2.5 py-1 rounded-full ${
                  decision.urgency === 'Critical' ? 'bg-alert/10 text-alert' : 'bg-amber/20 text-dusk'
                }`}
              >
                {decision.urgency.toLowerCase()}
              </span>
            </div>

            <p className="text-sm text-muted leading-relaxed">{decision.rationale_for_selection}</p>

            <div className="border-t border-lavender/20 pt-3">
              <p className="text-sm text-ink leading-relaxed">{decision.dispatch_message}</p>
            </div>

            {dispatchStatus && (
              <p className="font-mono text-xs text-muted pt-1">{dispatchStatus}</p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
