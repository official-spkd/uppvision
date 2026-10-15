import React, { useState } from 'react';
import { BookOpen, ListChecks, CheckCircle2, Info } from 'lucide-react';
import guide from '../docs/auto-comment-guide.json';
import './guide.css';

export default function GuideWorkspace() {
  const [platform, setPlatform] = useState('ig');
  const current = guide.platforms.find(p => p.id === platform);
  return <div className="guide-workspace">
    <section className="settings-card guide-intro"><span className="guide-icon"><BookOpen size={24} /></span><div><h2>{guide.title}</h2><p>{guide.intro}</p><span className="guide-date">Diperbarui {guide.updated}</span></div></section>
    <section className="settings-card"><div className="guide-heading"><Info size={20} /><h2>{guide.runtime.title}</h2></div><p>{guide.runtime.intro}</p><ul className="guide-steps">{guide.runtime.notes.map(note => <li key={note.title}><div><h3>{note.title}</h3><p>{note.text}</p></div></li>)}</ul></section>
    <section className="settings-card"><div className="guide-heading"><ListChecks size={20} /><h2>Urutan kerja yang menjadi patokan</h2></div><ol className="guide-steps">{guide.steps.map((step, i) => <li key={step.title}><span className="guide-number">{i + 1}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></li>)}</ol></section>
    <section className="settings-card"><h2>Alur dan status tiap sosmed</h2><p>Periksa status ini sebelum menjalankan atau mengembangkan script.</p><div className="guide-tabs" role="tablist" aria-label="Panduan sosmed">{guide.platforms.map(p => <button key={p.id} id={`guide-tab-${p.id}`} role="tab" aria-selected={p.id === platform} aria-controls="guide-platform" onClick={() => setPlatform(p.id)}>{p.name}</button>)}</div><article id="guide-platform" role="tabpanel" aria-labelledby={`guide-tab-${platform}`} className="guide-platform"><div className="guide-platform-heading"><h3>{current.name}</h3><span>{current.status}</span></div><p><strong>Target:</strong> {current.target}</p><p>{current.flow}</p><div className="guide-limit"><Info size={18} /><p>{current.limits}</p></div><p className="guide-source">Sumber implementasi: <code>{current.source}</code></p></article></section>
    <section className="settings-card"><div className="guide-heading"><CheckCircle2 size={20} /><h2>Cara memantau pengujian</h2></div><ul className="guide-checks">{guide.verification.map(item => <li key={item}>{item}</li>)}</ul></section>
    {guide.accountCleanup && <section className="settings-card"><h2>{guide.accountCleanup.title}</h2><ol className="guide-checks">{guide.accountCleanup.steps.map(item => <li key={item}>{item}</li>)}</ol><p>{guide.accountCleanup.status}</p></section>}
    {guide.lastTest && <section className="settings-card"><h2>Hasil uji terbaru</h2><span className="guide-date">{guide.lastTest.date}</span><p>{guide.lastTest.scope}</p><p>{guide.lastTest.result}</p><h3>Perbaikan dari pengujian</h3><ul className="guide-checks">{guide.lastTest.fixes.map(fix => <li key={fix}>{fix}</li>)}</ul><p>{guide.lastTest.validation}</p></section>}
    <section className="settings-card guide-maintenance"><h2>Acuan untuk pengerjaan berikutnya</h2><p>{guide.maintenance}</p></section>
  </div>;
}
