const workflow = ["Audit", "Understand", "Remediate", "Human review", "Verify", "Publish"];

export default function Home() {
  return (
    <main>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="site-header">
        <a className="brand" href="#" aria-label="A11yRelay home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>A11yRelay</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#workflow">How it works</a>
          <a href="#workspace">Workspace</a>
          <a href="#webmcp">WebMCP</a>
        </nav>
        <a className="header-cta" href="/workspace">Launch demo <span aria-hidden="true">↗</span></a>
      </header>

      <section className="hero" id="main-content">
        <div className="hero-copy">
          <div className="eyebrow"><span aria-hidden="true" /> Agent-native accessibility remediation</div>
          <h1>Accessibility remediation for <em>humans</em> and AI agents.</h1>
          <p className="hero-lede">Find accessibility barriers. Fix what is safe. Ask humans when meaning matters. Publish a better web experience—without losing control.</p>
          <div className="hero-actions">
            <a className="button button-primary" href="/workspace">Launch the Arbor Creek demo <span aria-hidden="true">→</span></a>
            <a className="button button-quiet" href="#webmcp"><span className="play" aria-hidden="true">▶</span> See how WebMCP works</a>
          </div>
          <div className="proof-row" aria-label="Product highlights">
            <span><b>18</b> barriers detected</span>
            <span><b>7</b> safe fixes</span>
            <span><b>3</b> human decisions</span>
          </div>
        </div>

        <div className="hero-visual" id="workspace" aria-label="A11yRelay workspace preview">
          <div className="window-bar">
            <div className="window-dots" aria-hidden="true"><i /><i /><i /></div>
            <span>City of Arbor Creek</span>
            <span className="agent-ready"><i /> Agent ready</span>
          </div>
          <div className="app-frame">
            <aside className="preview-sidebar" aria-label="Workspace navigation preview">
              <span className="mini-brand"><span className="brand-mark" aria-hidden="true"><span /></span></span>
              {['Overview', 'Issues', 'Review', 'Compare', 'Reader'].map((item, index) => (
                <span className={index === 0 ? 'active' : ''} key={item}><i aria-hidden="true" />{item}</span>
              ))}
            </aside>
            <div className="preview-main">
              <div className="preview-heading">
                <div><small>ACCESSIBILITY OVERVIEW</small><h2>Good afternoon, Maya.</h2></div>
                <a className="preview-audit-link" href="/workspace">Run audit</a>
              </div>
              <div className="score-card">
                <div className="score-ring"><strong>58</strong><span>of 100</span></div>
                <div className="score-copy"><span>Current score</span><strong>Needs attention</strong><p>18 automatically detectable issues found.</p></div>
                <div className="severity-grid">
                  <span><i className="critical" />Critical <b>2</b></span>
                  <span><i className="serious" />Serious <b>5</b></span>
                  <span><i className="moderate" />Moderate <b>7</b></span>
                  <span><i className="minor" />Minor <b>4</b></span>
                </div>
              </div>
              <div className="issues-preview">
                <div className="section-label"><span>Priority issues</span><a href="/workspace">View all 18</a></div>
                <article><span className="issue-icon red" aria-hidden="true">!</span><div><strong>Missing document language</strong><small>HTML · WCAG 3.1.1</small></div><span className="confidence">98% safe fix</span></article>
                <article><span className="issue-icon amber" aria-hidden="true">?</span><div><strong>Chart needs a meaningful description</strong><small>IMG · WCAG 1.1.1</small></div><span className="review-chip">Human review</span></article>
              </div>
            </div>
            <aside className="activity-panel">
              <div className="activity-title"><span>Agent activity</span><i /></div>
              <div className="agent-call"><span className="code-icon" aria-hidden="true">⌁</span><div><strong>audit_content</strong><small>Found 18 issues</small></div><time>now</time></div>
              <div className="agent-call"><span className="check-icon" aria-hidden="true">✓</span><div><strong>inspect_issue</strong><small>Document language</small></div><time>2s</time></div>
              <div className="waiting-card"><span>Waiting for you</span><strong>Chart meaning needs context</strong><a href="/workspace">Review decision</a></div>
              <div className="tool-ready"><i /> 13 WebMCP tools available</div>
            </aside>
          </div>
        </div>
      </section>

      <section className="workflow" id="workflow" aria-labelledby="workflow-heading">
        <div><span className="section-kicker">A better workflow</span><h2 id="workflow-heading">A scanner tells you what’s wrong.<br />A11yRelay helps you fix it.</h2></div>
        <ol>{workflow.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, '0')}</span>{step}{index < workflow.length - 1 && <i aria-hidden="true">→</i>}</li>)}</ol>
      </section>

      <section className="architecture-section" id="webmcp" aria-labelledby="architecture-heading">
        <div className="architecture-copy">
          <span className="section-kicker">WebMCP, built in</span>
          <h2 id="architecture-heading">One workspace.<br/>Two native interfaces.</h2>
          <p>Humans use a precise visual workspace. Agents use purpose-built WebMCP tools. Both act on the same reversible project state.</p>
          <a className="button button-primary" href="/workspace">Explore the tool layer <span aria-hidden="true">→</span></a>
        </div>
        <div className="architecture-diagram" aria-label="AI agent and human interface share the A11yRelay project state">
          <div className="arch-node agent-node"><small>External reasoning</small><strong>AI Agent</strong><span>Audit · inspect · propose</span></div>
          <span className="arch-connector" aria-hidden="true">↓</span>
          <div className="arch-node protocol-node"><small>Browser protocol</small><strong>WebMCP Tool Layer</strong><code>apply_safe_fixes</code></div>
          <span className="arch-connector" aria-hidden="true">↓</span>
          <div className="arch-node state-node"><small>Single source of truth</small><strong>Shared Project State</strong><span>Versioned · reversible · verified</span></div>
          <div className="arch-branches" aria-hidden="true"><i/><i/></div>
          <div className="arch-results"><div><small>For people</small><strong>Human workspace</strong><span>Review & approve</span></div><div><small>For readers</small><strong>Accessible Web Twin</strong><span>Preview & publish</span></div></div>
        </div>
      </section>

      <section className="landing-cta">
        <span className="eyebrow"><span aria-hidden="true"/> City of Arbor Creek demo</span>
        <h2>Don’t just find barriers.<br/>Build the fix.</h2>
        <p>Run the deterministic audit, apply safe changes, provide human context, compare semantics, verify, and publish.</p>
        <a className="button button-primary" href="/workspace">Launch A11yRelay <span aria-hidden="true">→</span></a>
      </section>
      <footer className="landing-footer"><a className="brand" href="#"><span className="brand-mark" aria-hidden="true"><span/></span><span>A11yRelay</span></a><p>Make the web accessible, together.</p><span>Accessibility remediation—not legal certification.</span></footer>
    </main>
  );
}
