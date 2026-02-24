// Tooltip data voor alle statistieken
const STAT_TOOLTIPS = {
  // Dashboard - Lead Pipeline
  'total-leads': {
    title: 'Total Leads',
    formula: 'Som van alle leads in het systeem',
    explanation: 'Totaal aantal leads ongeacht status of bron. Inclusief cold leads, flyer actie en warme CRM leads.',
    scope: 'Alle leads (cold, flyer, warm/CRM)'
  },
  'verstuurd': {
    title: 'Verstuurd',
    formula: 'Aantal leads met status VERSTUURD of GEEN_REACTIE',
    explanation: 'Aantal cold outreach emails die zijn verstuurd. Warme CRM leads worden NIET meegeteld omdat zij geen cold email ontvangen.',
    scope: 'Alleen cold en flyer leads'
  },
  'reacties': {
    title: 'Reacties',
    formula: 'Aantal leads met status GEREAGEERD of NIET_GEINTERESSEERD',
    explanation: 'Aantal leads dat heeft gereageerd op de cold outreach, positief of negatief.',
    scope: 'Alleen cold en flyer leads'
  },
  'interesse': {
    title: 'Interesse',
    formula: 'Aantal leads met status AFSPRAAK',
    explanation: 'Aantal leads dat interesse heeft getoond en waarmee een afspraak is gemaakt.',
    scope: 'Alleen cold en flyer leads'
  },
  'send-rate': {
    title: 'Send Rate',
    formula: '(Verstuurd / Totaal pipeline leads) × 100',
    explanation: 'Percentage van de cold/flyer leads waarnaar een email is verstuurd. Hoe hoger, hoe actiever je outreach.',
    scope: 'Alleen cold en flyer leads'
  },
  'response-rate': {
    title: 'Response Rate',
    formula: '(Gereageerd / Verstuurd) × 100',
    explanation: 'Percentage leads dat heeft gereageerd op de cold outreach. Hoe hoger, hoe beter je messaging aanslaat bij de doelgroep.',
    scope: 'Alleen cold en flyer leads'
  },
  'interest-rate': {
    title: 'Interest Rate',
    formula: '(Interesse / Gereageerd) × 100',
    explanation: 'Percentage van de reacties dat daadwerkelijk interesse toont. Meet de kwaliteit van je targeting en propositie.',
    scope: 'Alleen cold en flyer leads'
  },
  'close-rate': {
    title: 'Close Rate',
    formula: '(Klanten / Interesse) × 100',
    explanation: 'Percentage geïnteresseerde leads dat daadwerkelijk klant wordt. Meet je sales effectiviteit.',
    scope: 'Alleen cold en flyer leads'
  },
  
  // Dashboard - Klanten & Omzet
  'totaal-klanten': {
    title: 'Totaal Klanten',
    formula: 'Aantal leads met status KLANT',
    explanation: 'Totaal aantal actieve klanten in het systeem, ongeacht acquisitiekanaal.',
    scope: 'Alle klanten (cold, flyer, warm/CRM)'
  },
  'mrr': {
    title: 'MRR - Monthly Recurring Revenue',
    formula: 'Hosting MRR + Maandelijkse upsells MRR',
    explanation: 'Maandelijks terugkerende omzet. Dit is voorspelbare inkomsten die elke maand binnenkomt van hosting en maandelijkse upsells.',
    scope: 'Alle actieve hosting en maandelijkse upsells'
  },
  'omzet-jaar': {
    title: 'Omzet dit jaar',
    formula: 'Eenmalig + Hosting (dit jaar) + Upsells (dit jaar)',
    explanation: 'Totale omzet voor het geselecteerde jaar. Eenmalig = deals verkocht dit jaar. Hosting/upsells = maandprijs × actieve maanden dit jaar.',
    scope: 'Deals verkocht dit jaar + actieve recurring dit jaar'
  },
  'gem-acquisitiekost': {
    title: 'Gemiddelde Acquisitiekost',
    formula: 'Totale acquisitiekosten / Aantal klanten',
    explanation: 'Gemiddelde kosten om één klant te werven. Lagere kosten = efficiëntere acquisitie.',
    scope: 'Alle klanten met geregistreerde acquisitiekosten'
  },
  
  // Locatie statistieken
  'loc-totaal': {
    title: 'Totaal Leads',
    formula: 'Som van alle leads in deze gemeente',
    explanation: 'Totaal aantal leads in deze gemeente, ongeacht status of bron.',
    scope: 'Alle leads in deze gemeente'
  },
  'loc-verstuurd': {
    title: 'Verstuurd',
    formula: 'Aantal cold/flyer leads met status ≥ VERSTUURD',
    explanation: 'Aantal cold outreach emails verstuurd naar deze gemeente. Warme CRM leads worden NIET meegeteld.',
    scope: 'Alleen cold en flyer leads'
  },
  'loc-reactie': {
    title: 'Reactie',
    formula: 'Aantal cold/flyer leads met status ≥ GEREAGEERD',
    explanation: 'Aantal leads uit deze gemeente dat heeft gereageerd op cold outreach.',
    scope: 'Alleen cold en flyer leads'
  },
  'loc-response-rate': {
    title: 'Response Rate',
    formula: '(Gereageerd / Verstuurd) × 100',
    explanation: 'Percentage reacties in deze gemeente. Meet hoe goed je messaging aanslaat in dit gebied.',
    scope: 'Alleen cold en flyer leads'
  },
  'loc-klanten': {
    title: 'Klanten',
    formula: 'Aantal leads met status KLANT',
    explanation: 'Aantal klanten in deze gemeente, ongeacht acquisitiekanaal.',
    scope: 'Alle klanten in deze gemeente'
  },
  'loc-conversion-rate': {
    title: 'Conversion Rate',
    formula: '(Klanten / Gereageerd) × 100',
    explanation: 'Percentage van de reacties dat klant wordt. Meet sales effectiviteit in dit gebied.',
    scope: 'Alleen cold en flyer leads'
  },
  'loc-omzet': {
    title: 'Omzet',
    formula: 'Som van alle dealwaardes in deze gemeente',
    explanation: 'Totale omzet gegenereerd uit deze gemeente.',
    scope: 'Alle klanten in deze gemeente'
  },
  
  // Stats - Funnel
  'funnel-totaal': {
    title: 'Totaal Leads',
    formula: 'Som van alle cold en flyer leads',
    explanation: 'Totaal aantal leads in de cold outreach pipeline. Warme CRM leads zijn uitgesloten.',
    scope: 'Alleen cold en flyer leads'
  },
  'funnel-verstuurd': {
    title: 'Verstuurd',
    formula: 'Aantal leads met status ≥ VERSTUURD',
    explanation: 'Aantal cold outreach emails die zijn verstuurd.',
    scope: 'Alleen cold en flyer leads'
  },
  'funnel-gereageerd': {
    title: 'Gereageerd',
    formula: 'Aantal leads met status ≥ GEREAGEERD',
    explanation: 'Aantal leads dat heeft gereageerd op de outreach.',
    scope: 'Alleen cold en flyer leads'
  },
  'funnel-interesse': {
    title: 'Interesse',
    formula: 'Aantal leads met status AFSPRAAK of KLANT',
    explanation: 'Aantal leads met concrete interesse (afspraak gemaakt of klant geworden).',
    scope: 'Alleen cold en flyer leads'
  },
  'funnel-klanten': {
    title: 'Klanten',
    formula: 'Aantal leads met status KLANT',
    explanation: 'Aantal leads dat klant is geworden via cold outreach.',
    scope: 'Alleen cold en flyer leads'
  },
  
  // Stats - Revenue
  'rev-omzet-jaar': {
    title: 'Omzet dit jaar',
    formula: 'Eenmalig + Hosting + Upsells (geselecteerd jaar)',
    explanation: 'Totale omzet voor het geselecteerde boekjaar.',
    scope: 'Deals verkocht dit jaar + actieve recurring dit jaar'
  },
  'rev-pakket-omzet': {
    title: 'Pakket Omzet',
    formula: 'Som van alle pakketten (alle jaren) - kortingen',
    explanation: 'Totale pakketomzet sinds het begin, NIET alleen dit jaar. Meet de totale waarde van verkochte pakketten.',
    scope: 'Alle deals ooit verkocht'
  },
  'rev-hosting-jaar': {
    title: 'Hosting dit jaar',
    formula: 'Som van (maandprijs × actieve maanden dit jaar)',
    explanation: 'Hosting omzet voor dit jaar. Berekend per klant: maandprijs × aantal actieve maanden in dit jaar.',
    scope: 'Alle actieve hosting klanten dit jaar'
  },
  'rev-mrr': {
    title: 'MRR - Monthly Recurring Revenue',
    formula: 'Hosting MRR + Maandelijkse upsells MRR',
    explanation: 'Totale maandelijks terugkerende omzet. Dit is voorspelbare inkomsten per maand.',
    scope: 'Alle actieve hosting en maandelijkse upsells'
  },
  'rev-gem-deal': {
    title: 'Gemiddelde Dealwaarde',
    formula: 'Totale omzet dit jaar / Aantal deals dit jaar',
    explanation: 'Gemiddelde waarde per verkochte deal dit jaar.',
    scope: 'Deals verkocht dit jaar'
  },
  
  // Stats - Monthly chart
  'monthly-pakketten': {
    title: 'Pakketten (maandgrafiek)',
    formula: 'Eenmalige pakketomzet in verkoopmaand',
    explanation: 'Eenmalige pakketomzet wordt volledig geteld in de maand van verkoop.',
    scope: 'Deals verkocht in deze maand'
  },
  'monthly-upsells': {
    title: 'Upsells (maandgrafiek)',
    formula: 'Eenmalige upsells in verkoopmaand + maandelijkse upsells',
    explanation: 'Eenmalige upsells in verkoopmaand. Maandelijkse upsells worden verdeeld over alle actieve maanden.',
    scope: 'Upsells verkocht/actief in deze maand'
  },
  'monthly-hosting': {
    title: 'Hosting (maandgrafiek)',
    formula: 'Som van maandprijzen van actieve hosting',
    explanation: 'Hosting wordt correct verdeeld: elke maand telt de som van alle actieve hosting abonnementen (maandprijs).',
    scope: 'Actieve hosting in deze maand'
  },
  
  // Stats - Channels
  'channel-flyer': {
    title: 'Flyer Acquisitie',
    formula: 'Omzet, kosten, aantal en ROI van flyer kanaal',
    explanation: 'Performance van het flyer acquisitiekanaal. ROI = (Omzet - Kosten) / Kosten × 100.',
    scope: 'Alleen deals met acquisitionType = flyer'
  },
  'channel-warm': {
    title: 'Warme Leads',
    formula: 'Omzet, kosten, aantal en ROI van warme leads',
    explanation: 'Performance van warme leads (referrals, CRM, etc). ROI = (Omzet - Kosten) / Kosten × 100.',
    scope: 'Alle deals behalve flyer'
  },
  
  // Stats - Locations tab
  'loc-tab-gemeentes': {
    title: 'Aantal Gemeentes',
    formula: 'Aantal unieke gemeentes in dataset',
    explanation: 'Aantal verschillende gemeentes waar leads vandaan komen.',
    scope: 'Gefilterde dataset (all/flyer/warm)'
  },
  'loc-tab-totaal': {
    title: 'Totaal Leads',
    formula: 'Som van alle leads in gefilterde dataset',
    explanation: 'Totaal aantal leads in de geselecteerde filter (alle/flyer/warme leads).',
    scope: 'Gefilterde dataset (all/flyer/warm)'
  },
  'loc-tab-gem-response': {
    title: 'Gemiddelde Response Rate',
    formula: 'Gemiddelde van alle gemeente response rates',
    explanation: 'Gemiddelde reactieratio over alle gemeentes. Meet overall performance per regio.',
    scope: 'Gefilterde dataset (all/flyer/warm)'
  },
  'loc-tab-totaal-klanten': {
    title: 'Totaal Klanten',
    formula: 'Som van alle klanten in gefilterde dataset',
    explanation: 'Totaal aantal klanten in de geselecteerde filter.',
    scope: 'Gefilterde dataset (all/flyer/warm)'
  },
  'loc-tab-totaal-omzet': {
    title: 'Totale Omzet',
    formula: 'Som van alle omzet in gefilterde dataset',
    explanation: 'Totale omzet gegenereerd in de geselecteerde filter.',
    scope: 'Gefilterde dataset (all/flyer/warm)'
  },
  
  // Hosting
  'hosting-klanten': {
    title: 'Hosting Klanten',
    formula: 'Aantal actieve hosting abonnementen',
    explanation: 'Aantal klanten met actieve hosting in het geselecteerde jaar.',
    scope: 'Actieve hosting dit jaar'
  },
  'hosting-mrr': {
    title: 'MRR Hosting',
    formula: 'Som van alle maandelijkse hosting prijzen',
    explanation: 'Totale maandelijkse hosting omzet. Dit is voorspelbare inkomsten per maand.',
    scope: 'Alle actieve hosting klanten'
  },
  'hosting-omzet-jaar': {
    title: 'Hosting Omzet dit jaar',
    formula: 'Som van (maandprijs × actieve maanden dit jaar)',
    explanation: 'Totale hosting omzet voor dit jaar. Berekend per klant op basis van actieve maanden.',
    scope: 'Actieve hosting klanten dit jaar'
  },
  'hosting-gem-klant': {
    title: 'Gemiddelde per Klant/Maand',
    formula: 'Totale MRR / Aantal klanten',
    explanation: 'Gemiddelde maandelijkse hosting prijs per klant.',
    scope: 'Alle actieve hosting klanten'
  },

  // Winst & Kosten
  'winst-jaar': {
    title: 'Winst dit jaar',
    formula: 'Omzet (jaar) - Kosten (jaar)',
    explanation: 'Netto winst voor het geselecteerde jaar. Omzet = eenmalig (deals dit jaar) + hosting (actieve maanden) + upsells (actieve maanden). Kosten = acquisitiekosten + pakket kostprijs + hosting kostprijs × actieve maanden + upsell kostprijzen.',
    scope: 'Alle actieve deals dit jaar'
  },
  'kosten-jaar': {
    title: 'Kosten dit jaar',
    formula: 'Acquisitiekosten + Pakket kostprijs + Hosting kostprijs × actieve maanden + Upsell kostprijzen',
    explanation: 'Totale kosten voor dit jaar. Stel kostprijzen in via Pakketten & Prijzen en hostingkostprijzen via de Hosting pagina.',
    scope: 'Alle actieve deals dit jaar'
  }
};

// Helper functie om tooltip HTML te genereren
function createTooltipHTML(tooltipKey) {
  const data = STAT_TOOLTIPS[tooltipKey];
  if (!data) return '';
  
  return `
    <span class="stat-tooltip-icon">
      ?
      <span class="stat-tooltip-content">
        <div class="stat-tooltip-title">${data.title}</div>
        <div class="stat-tooltip-formula">${data.formula}</div>
        <div class="stat-tooltip-explanation">${data.explanation}</div>
        <div class="stat-tooltip-scope">Scope: ${data.scope}</div>
      </span>
    </span>
  `;
}

// Helper functie om label met tooltip te wrappen
function wrapWithTooltip(labelHTML, tooltipKey) {
  const tooltipHTML = createTooltipHTML(tooltipKey);
  if (!tooltipHTML) return labelHTML;
  
  return `<span class="stat-tooltip-wrapper">${labelHTML}${tooltipHTML}</span>`;
}
