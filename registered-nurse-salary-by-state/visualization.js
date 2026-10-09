// Reusable, dependency-free state comparison. Occupation content lives in JSON.
const COLORS = ['#deebf7', '#a8cce6', '#6da7cf', '#337eb5', '#135286'];
export function formatValue(value, metric, status = 'Not available') {
  if (value === null || value === undefined) return status;
  return new Intl.NumberFormat('en-US', {style:metric.format === 'currency' ? 'currency' : 'decimal', ...(metric.format === 'currency' ? {currency:'USD'} : {}), minimumFractionDigits:metric.decimals ?? 0, maximumFractionDigits:metric.decimals ?? 0}).format(value);
}
export function makeThresholds(values) {
  const sorted = values.filter(Number.isFinite).sort((a,b)=>a-b);
  if (sorted.length < 2 || sorted[0] === sorted.at(-1)) return [];
  const span = sorted.at(-1)-sorted[0];
  const magnitude = 10 ** Math.floor(Math.log10(span / 10));
  const step = (span / 10 / magnitude >= 5 ? 5 : span / 10 / magnitude >= 2 ? 2 : 1) * magnitude;
  return [...new Set([.2,.4,.6,.8].map(q=>Math.round(sorted[Math.floor((sorted.length-1)*q)]/step)*step))].filter(x=>x>sorted[0] && x<sorted.at(-1));
}
export function sortRows(rows, key, direction) {
  return [...rows].sort((a,b)=>{
    if(a[key] == null) return b[key] == null ? a.state.localeCompare(b.state) : 1;
    if(b[key] == null) return -1;
    const result = typeof a[key] === 'string' ? a[key].localeCompare(b[key]) : a[key]-b[key];
    return result * (direction === 'ascending' ? 1 : -1) || a.state.localeCompare(b.state);
  });
}
export function salaryCSV(rows) {
  const fields=['state','abbreviation','medianAnnualWage','medianHourlyWage','employment'];
  const escape=value=>/[",\r\n]/.test(String(value))?'"'+String(value).replaceAll('"','""')+'"':String(value);
  return [['State','Abbreviation','Median Annual Wage','Median Hourly Wage','Employment'].join(','),...sortRows(rows,'state','ascending').map(row=>fields.map(key=>escape(row[key]==null?'':key==='medianHourlyWage'?row[key].toFixed(2):row[key])).join(','))].join('\r\n')+'\r\n';
}
const el = (tag, text, cls) => {const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
async function json(url) {const r=await fetch(url,{cache:'no-cache'});if(!r.ok)throw new Error(`Could not load ${url} (${r.status})`);return r.json();}

export class StateComparison extends HTMLElement {
  async connectedCallback() {
    if(this.loaded)return; this.loaded=true;
    try {
      const configURL=new URL(this.getAttribute('config'),document.baseURI);
      this.config=await json(configURL);
      [this.data,this.geometry]=await Promise.all([json(new URL(this.config.dataFile,configURL)),json(new URL('./data/us-states.json',import.meta.url))]);
      this.validate();this.render();
    } catch(error) {this.replaceChildren(el('p',`The state comparison could not be loaded. ${error.message}`,'error'));}
  }
  validate() {
    const expected=new Map(this.geometry.states.map(g=>[g.fips,g.state]));
    if(this.data.states.length!==50||expected.size!==50)throw new Error('Exactly 50 states are required.');
    const ids=new Set(),abbr=new Set();
    for(const row of this.data.states){
      if(expected.get(row.fips)!==row.state||ids.has(row.fips)||abbr.has(row.abbreviation)||!/^[A-Z]{2}$/.test(row.abbreviation))throw new Error('Invalid or duplicate state.');
      ids.add(row.fips);abbr.add(row.abbreviation);
      for(const key of Object.keys(this.config.metrics))if(row[key]!==null&&!Number.isFinite(row[key]))throw new Error(`Invalid numeric value: ${row.state} ${key}`);
    }
    if(!this.config.metrics[this.config.primaryMetric])throw new Error('Primary metric must be configured.');
  }
  value(row,key){return formatValue(row[key],this.config.metrics[key],row.status?.[key]||'Not available');}
  render(){
    const c=this.config, source=this.data.source, metric=c.metrics[c.primaryMetric];
    this.rows=this.data.states;this.byId=new Map(this.rows.map(r=>[r.fips,r]));
    this.thresholds=makeThresholds(this.rows.map(r=>r[c.primaryMetric]));
    this.sortKey=c.primaryMetric;this.direction='descending';
    document.title=`${c.title} | United States Demographics`;
    document.querySelector('#page-title').textContent=c.title;
    document.querySelector('#subtitle').textContent=c.subtitle;
    document.querySelector('meta[name="description"]').content=c.subtitle;
    this.replaceChildren();
    const meta=el('div',undefined,'meta');meta.append(el('span',source.period.toUpperCase()),el('span','50 STATES'),el('span',`SOC ${source.soc}`));this.append(meta);
    const heading=el('div',undefined,'map-heading');heading.append(el('h2',metric.label),el('span','Hover, tap, or select a state to explore.','hint'));this.append(heading);
    this.mapWrap=el('div',undefined,'map-wrap');
    const ns='http://www.w3.org/2000/svg';this.svg=document.createElementNS(ns,'svg');this.svg.setAttribute('viewBox',this.geometry.viewBox);this.svg.setAttribute('class','state-map');this.svg.setAttribute('role','group');this.svg.setAttribute('aria-label',`US map: ${metric.label}`);
    for(const g of this.geometry.states){const row=this.byId.get(g.fips),p=document.createElementNS(ns,'path');p.setAttribute('d',g.path);p.setAttribute('class','state');p.setAttribute('fill',this.color(row[c.primaryMetric]));p.setAttribute('tabindex','0');p.setAttribute('role','button');p.setAttribute('aria-label',`${row.state}: ${metric.label} ${this.value(row,c.primaryMetric)}`);p.dataset.fips=g.fips;
      p.addEventListener('focus',()=>this.show(row,p,false));
      p.addEventListener('blur',()=>{if(!this.hoveredPath)this.restoreSelection();});
      p.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.show(row,p,true);}if(e.key==='Escape')this.hide();});this.svg.append(p);
    }
    // Paint the exact active geometry last, above every neighbouring polygon.
    // The outline is purely decorative: it cannot grow or steal a hit area.
    this.highlight=document.createElementNS(ns,'path');
    this.highlight.setAttribute('class','state-highlight');
    this.highlight.setAttribute('fill','none');
    this.highlight.setAttribute('pointer-events','none');
    this.highlight.setAttribute('aria-hidden','true');
    this.highlight.setAttribute('focusable','false');
    this.svg.append(this.highlight);
    // One shared event path for all polygons and islands. Only leaving the SVG
    // restores a selection; individual path boundaries cannot race each other.
    const stateAtEvent=e=>e.target.closest?.('path.state');
    const preview=e=>{
      if(this.selection||e.pointerType==='touch')return;
      const path=stateAtEvent(e);
      if(path===this.hoveredPath)return;
      this.hoveredPath=path;
      if(path)this.show(this.byId.get(path.dataset.fips),path,false);
      else this.restoreSelection();
    };
    this.svg.addEventListener('pointerover',preview);
    this.svg.addEventListener('pointermove',preview);
    this.svg.addEventListener('pointerleave',()=>{this.hoveredPath=null;this.restoreSelection();});
    this.svg.addEventListener('click',e=>{const path=stateAtEvent(e);if(path)this.show(this.byId.get(path.dataset.fips),path,true);});
    this.tip=el('div',undefined,'tooltip');this.tip.setAttribute('role','status');this.tip.setAttribute('aria-live','polite');this.tip.hidden=true;
    this.mapWrap.append(this.svg,this.tip);this.append(this.mapWrap);
    const legend=el('div',undefined,'legend');legend.setAttribute('aria-label',`${metric.label} ranges`);
    const f=x=>formatValue(x,metric);
    for(let i=0;i<=this.thresholds.length;i++){const label=!this.thresholds.length?'All reported values':i===0?`Under ${f(this.thresholds[0])}`:i===this.thresholds.length?`${f(this.thresholds[i-1])} or more`:`${f(this.thresholds[i-1])}–${f(this.thresholds[i] - 10**-(metric.decimals??0))}`;const item=el('span',undefined,'legend-item'),swatch=el('span',undefined,'swatch');swatch.style.background=COLORS[i];item.append(swatch,el('span',label));legend.append(item);}
    if(this.rows.some(r=>r[c.primaryMetric]===null)){const item=el('span','Not available','legend-item'),sw=el('span',undefined,'swatch');sw.style.background='#e3e5e7';item.prepend(sw);legend.append(item);}this.append(legend);
    const controls=el('div',undefined,'map-controls'),label=el('label','Explore a state');this.select=el('select');this.select.id='state-select';label.htmlFor=this.select.id;const placeholder=el('option','Select a state');placeholder.value='';this.select.append(placeholder);for(const r of sortRows(this.rows,'state','ascending')){const o=el('option',r.state);o.value=r.fips;this.select.append(o);}this.select.addEventListener('change',()=>{const r=this.byId.get(this.select.value);if(r)this.show(r,this.svg.querySelector(`[data-fips="${r.fips}"]`),true);else this.hide();});controls.append(label,this.select);this.append(controls);
    const section=el('section',undefined,'table-section'),row=el('div',undefined,'section-row');row.append(el('h2','Compare all 50 states'));const download=el('a','Download data ↓');const downloadURL=new URL(c.downloadFile,new URL(this.getAttribute('config'),document.baseURI));download.href=downloadURL;download.download=downloadURL.pathname.split('/').at(-1);
    // Generate the exact five-column export from the already validated data.
    // A missing copied CSV or a deployment prefix can no longer break a click.
    download.addEventListener('click',e=>{
      e.preventDefault();
      const url=URL.createObjectURL(new Blob([salaryCSV(this.rows)],{type:'text/csv;charset=utf-8'}));
      const link=el('a');link.href=url;link.download=download.download;this.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    });row.append(download);section.append(row);
    const scroll=el('div',undefined,'table-scroll');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Sortable state estimates');this.table=el('table');this.caption=el('caption');this.table.append(this.caption);const head=el('thead'),tr=el('tr');this.headers=[];
    for(const key of ['state',...c.tableMetrics]){const th=el('th');th.scope='col';const b=el('button');b.type='button';b.addEventListener('click',()=>{this.direction=this.sortKey===key&&this.direction==='descending'?'ascending':this.sortKey===key?'descending':key==='state'?'ascending':'descending';this.sortKey=key;this.renderTable();});th.append(b);this.headers.push({key,th,b});tr.append(th);}head.append(tr);this.body=el('tbody');this.table.append(head,this.body);scroll.append(this.table);section.append(scroll);this.append(section);this.renderTable();
    const note=el('section',undefined,'source');note.append(el('p',`Source: ${source.organization}, ${source.program}, ${source.period}.`));const link=el('a','Official BLS state estimates ↗');link.href=source.url;note.append(link);note.append(el('p','Standard state estimates, cross-industry. Annual wages are reported BLS estimates; they are not recalculated from rounded hourly wages. DC and territories are excluded. A median is the midpoint of the wage distribution; a mean is an average.'));
    note.append(el('p','Map ranges use approximate quintiles rounded to readable boundaries. Alaska and Hawaii are inset and not to scale. Unavailable or suppressed values are labeled, excluded from color ranges, and sorted last.'));
    this.append(note);
    this.addEventListener('keydown',e=>{if(e.key==='Escape')this.hide();});
  }
  color(v){return v===null?'#e3e5e7':COLORS[this.thresholds.filter(t=>v>=t).length];}
  renderTable(){
    this.caption.textContent=`Sorted by ${this.sortKey==='state'?'state':this.config.metrics[this.sortKey].label.toLowerCase()}, ${this.direction==='descending'?'highest to lowest':'ascending'}. Select a column heading to change the order.`;
    for(const {key,th,b} of this.headers){th.setAttribute('aria-sort',key===this.sortKey?this.direction:'none');b.textContent=(key==='state'?'State':this.config.metrics[key].label)+` ${key===this.sortKey?(this.direction==='descending'?'↓':'↑'):'↕'}`;}
    this.body.replaceChildren();for(const row of sortRows(this.rows,this.sortKey,this.direction)){const tr=el('tr');tr.dataset.fips=row.fips;const state=el('td',row.state);state.append(el('span',row.abbreviation,'abbr'));tr.append(state);for(const key of this.config.tableMetrics){const td=el('td',this.value(row,key));td.dataset.metric=key;tr.append(td);}this.body.append(tr);}
  }
  show(row,path,pinned){
    // Only an explicit click, keyboard activation or dropdown change can
    // replace a selection. Hover and keyboard-focus previews cannot unlock it.
    if(this.selection&&!pinned)return;
    if(pinned)this.selection={row,path};this.select.value=this.selection?.row.fips || row.fips;
    for(const p of this.svg.querySelectorAll('.state'))p.classList.toggle('selected',p===path);
    this.highlight.setAttribute('d',path.getAttribute('d'));
    this.tip.replaceChildren(el('strong',row.state));const close=el('button','×','close');close.type='button';close.setAttribute('aria-label','Close state details');close.onclick=()=>this.hide();this.tip.append(close);
    // Hover details are completely transparent to the pointer, including ×.
    // The close button becomes clickable when the user selects a state.
    this.tip.classList.toggle('is-pinned',Boolean(pinned));
    for(const key of this.config.tooltipMetrics){const p=el('p');p.append(el('span',this.config.metrics[key].label+':'),el('b',this.value(row,key)));this.tip.append(p);}this.tip.hidden=false;
    const box=path.getBoundingClientRect(),wrap=this.mapWrap.getBoundingClientRect(),width=this.tip.offsetWidth;
    const right=box.right-wrap.left+10,left=box.left-wrap.left-width-10;
    // Flip to the left when the eastern edge has no room, rather than clamping
    // the tooltip (and its close button) over the hovered state itself.
    this.tip.style.left=`${Math.max(0,Math.min(right+width<=wrap.width?right:left,wrap.width-width))}px`;
    this.tip.style.top=`${Math.max(0,Math.min(box.top-wrap.top,wrap.height-this.tip.offsetHeight))}px`;
  }
  restoreSelection(){if(this.selection)this.show(this.selection.row,this.selection.path,true);else this.hide();}
  hide(){this.selection=null;this.hoveredPath=null;this.tip.hidden=true;this.select.value='';this.highlight.removeAttribute('d');for(const p of this.svg.querySelectorAll('.state'))p.classList.remove('selected');}
}
customElements.define('state-comparison',StateComparison);
