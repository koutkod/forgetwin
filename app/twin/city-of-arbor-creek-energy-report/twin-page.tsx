'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Download, Leaf, Mail } from 'lucide-react';
import type { ProjectState } from '../../../lib/types';

const STORAGE_KEY = 'a11yrelay-demo-state-v1';

export default function TwinPage() {
  const [state, setState] = useState<ProjectState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw) as ProjectState);
    } finally {
      setLoaded(true);
    }
  }, []);

  const published = Boolean(state?.publishedVersion);
  const chartDescription = state?.humanContext['chart-alt'] || 'Energy consumption decreased 17% compared with last year.';

  if (!loaded) {
    return <main className="twin-gate"><span className="twin-seal">AC</span><h1>Loading Accessible Web Twin…</h1></main>;
  }

  if (!published) {
    return (
      <main className="twin-gate">
        <span className="twin-seal">AC</span>
        <p className="twin-kicker">City of Arbor Creek</p>
        <h1>This Accessible Web Twin has not been published yet.</h1>
        <p>Return to A11yRelay, apply safe fixes, verify the current version, and publish it.</p>
        <a href="/workspace"><ArrowLeft size={16}/> Return to A11yRelay</a>
      </main>
    );
  }

  return (
    <div className="twin-page">
      <a className="skip-link" href="#twin-main">Skip to report</a>
      <div className="twin-service-bar">
        <span><CheckCircle2 size={14}/> Accessible Web Twin · Published v{state?.publishedVersion}</span>
        <a href="/workspace">Open remediation workspace</a>
      </div>
      <header className="twin-header">
        <a className="twin-city" href="#top" aria-label="City of Arbor Creek home">
          <span className="twin-seal" aria-hidden="true">AC</span>
          <span><strong>City of Arbor Creek</strong><small>Office of Sustainability</small></span>
        </a>
        <nav aria-label="Report navigation">
          <a href="#summary">Summary</a><a href="#energy">Energy use</a><a href="#data">Data table</a><a href="#updates">Updates</a>
        </nav>
      </header>
      <main id="twin-main">
        <section className="twin-hero" id="top" aria-labelledby="twin-title">
          <span className="twin-kicker">2026 Community Energy Report</span>
          <h1 id="twin-title">A healthier city uses less energy.</h1>
          <p>Arbor Creek is reducing municipal energy use, lowering costs, and investing those savings in resilient neighborhoods.</p>
          <div className="twin-actions"><a href="#data"><Download size={16}/> View annual energy data</a><span>Updated August 2026</span></div>
        </section>
        <section className="twin-stat-row" aria-label="Report highlights">
          <div><strong>17%</strong><span>Less energy used than 2025</span></div>
          <div><strong>42</strong><span>City buildings upgraded</span></div>
          <div><strong>$3.1M</strong><span>Annual community savings</span></div>
        </section>
        <section className="twin-section" id="summary">
          <span className="twin-number">01</span>
          <div>
            <span className="twin-kicker">Executive summary</span>
            <h2>Efficiency is becoming infrastructure.</h2>
            <p>Arbor Creek used 17% less energy than last year. Building upgrades and lower residential demand drove most of the improvement, while commercial energy use continued a steady decline.</p>
            <aside><Leaf size={20}/><p>These figures describe measured energy consumption. They do not represent emissions reductions or a legal compliance target.</p></aside>
          </div>
        </section>
        <section className="twin-section twin-chart-section" id="energy">
          <span className="twin-number">02</span>
          <div>
            <span className="twin-kicker">Energy by sector</span>
            <h2>Demand fell across every measured sector.</h2>
            <figure>
              <div className="twin-chart" role="img" aria-label={chartDescription} aria-describedby="twin-chart-caption">
                <div><i style={{height:'93%'}}/><span>2023</span></div>
                <div><i style={{height:'100%'}}/><span>2024</span></div>
                <div><i style={{height:'77%'}}/><span>2025</span></div>
                <div><i style={{height:'60%'}}/><span>2026</span></div>
              </div>
              <figcaption id="twin-chart-caption">{chartDescription} Values are indexed to the 2023 baseline.</figcaption>
            </figure>
          </div>
        </section>
        <section className="twin-section" id="data">
          <span className="twin-number">03</span>
          <div>
            <span className="twin-kicker">Open data</span>
            <h2>Annual consumption by sector</h2>
            <div className="twin-table-wrap">
              <table>
                <caption>2025 and 2026 energy consumption in megawatt-hours by sector</caption>
                <thead><tr><th scope="col">Sector</th><th scope="col">2025 MWh</th><th scope="col">2026 MWh</th><th scope="col">Change</th></tr></thead>
                <tbody>
                  <tr><th scope="row">Municipal</th><td>18,400</td><td>15,900</td><td>−14%</td></tr>
                  <tr><th scope="row">Residential</th><td>62,100</td><td>49,800</td><td>−20%</td></tr>
                  <tr><th scope="row">Commercial</th><td>38,700</td><td>35,200</td><td>−9%</td></tr>
                </tbody>
              </table>
            </div>
            <a className="twin-download" href="data:text/csv;charset=utf-8,Sector%2C2025%20MWh%2C2026%20MWh%0AMunicipal%2C18400%2C15900%0AResidential%2C62100%2C49800%0ACommercial%2C38700%2C35200" download="arbor-creek-energy-data.csv"><Download size={15}/> Download the 2026 energy dataset (CSV)</a>
          </div>
        </section>
        <section className="twin-updates" id="updates" aria-labelledby="updates-heading">
          <div><Mail size={23}/><span className="twin-kicker">Stay informed</span><h2 id="updates-heading">Community energy updates</h2><p>Get monthly project news and public meeting notices.</p></div>
          {subscribed ? (
            <p className="twin-success" role="status"><CheckCircle2 size={18}/> You’re on the list. Check your inbox for confirmation.</p>
          ) : (
            <form onSubmit={(event) => {event.preventDefault();setSubscribed(true)}}>
              <label htmlFor="twin-email">Email address</label>
              <div><input id="twin-email" type="email" autoComplete="email" required/><button type="submit">Subscribe</button></div>
              <label className="twin-consent"><input type="checkbox" required/> I agree to receive monthly city energy updates.</label>
            </form>
          )}
        </section>
      </main>
      <footer className="twin-footer">
        <div><span className="twin-seal" aria-hidden="true">AC</span><span>City of Arbor Creek<br/>Public Information Office</span></div>
        <p>This companion version was published through A11yRelay. Manual accessibility review remains recommended.</p>
        <a href="#top">Back to top</a>
      </footer>
    </div>
  );
}
