# Confidence Interval Simulation

An interactive classroom visualisation of what the **confidence level** of a
confidence interval for a population proportion actually means: take repeated
samples from a population whose `p` you control, and watch what share of the
resulting intervals capture it.

Every interval on screen is the one-proportion *z* interval

```
( p̂ − z √( p̂(1−p̂) / n ) ,  p̂ + z √( p̂(1−p̂) / n ) )

z = | invNorm( (1 − C) / 2, 0, 1 ) |
```

Taking one sample steps through the working: the number of successes, `p̂ = X/n`,
`z` from `invNorm`, then the formula with those numbers substituted straight into
it to give each bound. The sheet then waits — the next click anywhere adds the
interval to the plot.

## Using it

| Panel | What it does |
| --- | --- |
| **Population & interval** | Set the population proportion `p`, the sample size `n`, and the confidence level `C`. Changing any of them clears the samples, so every interval on the plot shares the same `n` and `C`. |
| **Sample** | *Take a sample* draws one sample and steps through the working. *Take X samples* draws a batch straight onto the plot. |
| **Centre plot** | A self-scaling number line, a dashed line at the true `p`, and each interval drawn as `⟵ ● ⟶` above the axis. Blue captures `p`, red misses it. |
| **Statistics** | The count of intervals, how many capture `p`, and the capture rate — with a dashed mark at the confidence level to compare against. |
| **All intervals** | Every interval taken, numbered, newest first. |

Teaching points that fall out of it: the capture rate converges on `C` as
samples accumulate; raising `C` widens every interval; raising `n` narrows them;
and because this is the Wald interval, the true capture rate sits slightly
*below* `C` — dramatically so for small `n` or extreme `p`, where intervals can
even spill outside the shaded 0–1 boundary.

## Deploying to GitHub Pages

The site is plain static files at the repository root — no build step.

1. Commit and push to `main`.
2. **Settings → Pages → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.

It is then served at `https://<user>.github.io/confidence-interval-simulation/`.
Opening `index.html` from disk works too.

## Files

```
index.html    structure
styles.css    all styling; light theme, responsive down to a phone
app.js        maths, sampling, rendering, the step-by-step animation
```

Implementation notes: `invNorm` is Acklam's rational approximation of the
inverse normal CDF (error < 1.2e-9), so `z` matches a graphics calculator.
The formulas are typeset by `app.js` itself — the radical and brackets are SVG
paths stretched to whatever they wrap, so the page header and the working both
render from one function and stay identical.
Samples are exact binomial draws. The plot draws a fair random subset of at
most 50 intervals via reservoir sampling — the statistics always use every
sample taken — and the side list keeps the most recent 400 rows.
