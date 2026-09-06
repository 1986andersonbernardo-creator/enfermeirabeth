// Testes de lógica do Enfermeira Beth — node dev-test.mjs
import fs from "fs";

const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// ---- stubs de browser ----
const fakeEl = () => ({ classList:{add(){},remove(){},toggle(){}}, innerHTML:"", value:"", textContent:"", style:{}, files:[], remove(){} });
globalThis.window = { addEventListener(){}, matchMedia: () => ({ matches:false }) };
globalThis.document = { hidden:false, addEventListener(){}, querySelectorAll: () => [], getElementById: () => fakeEl() };
globalThis.localStorage = { _s:{}, getItem(k){ return this._s[k] ?? null; }, setItem(k,v){ this._s[k]=v; }, removeItem(k){ delete this._s[k]; } };
Object.defineProperty(globalThis, "navigator", { value:{}, configurable:true });
globalThis.confirm = () => false;
globalThis.location = { href:"http://localhost/" };

const EXPOSE = `;globalThis.__T = { get db(){ return db; }, syncVinculo, syncAll, resyncAfterEdit, duracaoHoras, financasMes,
  conflitosNoDia, valorDe, ocorrenciasDoDia, mapaDiasDoMes, dotStatuses,
  todayKey, mkey, datetimeOf, parseKey, dkey, uid };`;

// "Reabrir o app": clear=false mantém o localStorage (persistência); clear=true = instalação nova
function freshApp(clear = true){
  if(clear) localStorage._s = {};
  new Function(js + EXPOSE).call(globalThis);
  return globalThis.__T;
}

let pass = 0, fail = 0;
const assert = (c, m) => { if(c){ pass++; console.log("  ok -", m); } else { fail++; console.error("  FALHOU -", m); } };
const daysInMonth = mk => { const [y,m] = mk.split("-").map(Number); return new Date(y, m, 0).getDate(); };
const mkShift = (T, n) => { const [y,m] = T.mkey(new Date()).split("-").map(Number); return T.mkey(new Date(y, m-1+n, 1)); };
const sameSet = (a,b) => a.size === b.size && [...a].every(x => b.has(x));

// Dias que DEVEM ter bolinha: regra do motor (ciclo a partir da data inicial, só ocorrências
// cujo fim ainda não passou) + dias de continuação de plantão 24h.
function expectedDays(T, v, mk){
  const [y,m] = mk.split("-").map(Number);
  const D0 = T.parseKey(v.dataInicial);
  const cicloH = v.escala.trab + v.escala.folga; // ciclo em HORAS
  const durH = T.duracaoHoras(v);
  const out = new Set();
  // começa 2 dias antes do mês: plantão iniciado no fim do mês anterior pode continuar dentro deste mês
  for(let d=-2; d<=daysInMonth(mk); d++){
    const day = new Date(y, m-1, d);
    const diffH = Math.round((day - D0) / 3600000); // diferença em horas
    if(diffH < 0 || diffH % cicloH !== 0) continue;
    const start = T.datetimeOf(T.dkey(day), v.horaInicio).getTime();
    if(start + durH*3600000 <= Date.now()) continue;
    let cur = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const fim = start + durH*3600000;
    while(cur.getTime() < fim){
      const k = T.dkey(cur);
      if(k.startsWith(mk)) out.add(k); // continuação só conta dentro do mês analisado
      cur = new Date(cur.getTime()+86400000);
    }
  }
  return out;
}
const actualDays = (T, mk) => { const map = T.mapaDiasDoMes(mk); return new Set(Object.keys(map).filter(k => map[k].length)); };
const mkVinc = (T, nome, escala, hi, hf, valor) => ({ id:T.uid(), paciente:nome, cooperativa:"Coop "+nome,
  valorPorPlantao:valor, horaInicio:hi, horaFim:hf, dataInicial:T.todayKey(), escala, ativo:true, criadoEm:Date.now() });

// ============ [A] ESCALAS: bolinha APENAS nos dias de plantão ============
console.log("\n[A] Calendário por tipo de escala (bolinha só nos dias de plantão)");
const ESCALAS = [
  ["12x12 (simples)",     {trab:12,folga:12}, "07:00","19:00"],
  ["12x36",               {trab:12,folga:36}, "07:00","19:00"],
  ["24x48",               {trab:24,folga:48}, "07:00","07:00"],
  ["24x72",               {trab:24,folga:72}, "07:00","07:00"],
  ["personalizada 12x60", {trab:12,folga:60}, "07:00","19:00"],
];
for(const [nome, escala, hi, hf] of ESCALAS){
  const T = freshApp(true);
  const v = mkVinc(T, "Beth", escala, hi, hf, 180);
  T.db.vinculos.push(v); T.syncVinculo(v);
  const mk = T.mkey(new Date());
  const exp = expectedDays(T, v, mk), act = actualDays(T, mk);
  const missing = [...exp].filter(x => !act.has(x)), extra = [...act].filter(x => !exp.has(x));
  assert(sameSet(exp, act), `${nome}: 🔵 somente nos dias calculados (${act.size} dias)${(missing.length||extra.length) ? ` | esperados-faltando: ${missing.slice(0,3)} | inesperados: ${extra.slice(0,3)}` : ""}`);
  const w = [...exp].sort();
  if(w.length >= 2){
    const a = T.parseKey(w[0]), b = T.parseKey(w[1]);
    const meio = T.dkey(new Date(a.getTime() + Math.floor((b-a)/2/86400000)*86400000));
    if(!exp.has(meio)) assert(!act.has(meio), `${nome}: folga em ${meio} → sem bolinha`);
  }
  const dom = new Date(); dom.setDate(dom.getDate() + ((7 - dom.getDay()) % 7 || 7));
  const domKey = T.dkey(dom);
  assert(act.has(domKey) === exp.has(domKey),
    `${nome}: próximo domingo (${domKey}) → ${exp.has(domKey) ? "🔵 plantão previsto" : "⚪ folga"}`);
}
// ============ [B] MÚLTIPLOS PACIENTES + EXTRA + STATUS + TROCA DE MÊS ============
console.log("\n[B] Vários vínculos, plantão extra, mudança de status e navegação de mês");
{
  const T = freshApp(true);
  const hoje = T.todayKey();
  const mk = T.mkey(new Date());
  const maria = mkVinc(T, "Maria", {trab:12,folga:36}, "07:00","19:00", 180);
  const joao  = mkVinc(T, "João",  {trab:12,folga:36}, "19:00","07:00", 220);
  T.db.vinculos.push(maria, joao); T.syncVinculo(maria); T.syncVinculo(joao);
  const exp = new Set([...expectedDays(T, maria, mk), ...expectedDays(T, joao, mk)]);
  const act = actualDays(T, mk);
  assert(sameSet(exp, act), "bolinhas = união correta das 2 escalas (Maria + João)");

  const map = T.mapaDiasDoMes(mk);
  const hojeOccs = map[hoje] || [];
  assert(hojeOccs.filter(o => o.status === "previsto").length === 2, "2 plantões previstos no mesmo dia (07:00–19:00 e 19:00–07:00)");
  assert(T.dotStatuses(hojeOccs).join(",") === "previsto", "dia com 2 plantões previstos → 1 bolinha 🔵 só (sem duplicar)");

  // plantão extra no mesmo dia → bolinha 🟡 adicional (recalcula o mapa após inserir)
  const ini = T.datetimeOf(hoje, "22:00"), fim = T.datetimeOf(hoje, "22:00"); fim.setHours(fim.getHours()+8);
  T.db.ocorrencias.push({ id:T.uid(), vinculoId:null, extra:true, paciente:"Avulsa", cooperativa:"Beta",
    inicioISO:ini.getTime(), fimISO:fim.getTime(), status:"extra", editada:true, obs:"", valor:250,
    criadoEm:Date.now(), atualizadoEm:Date.now() });
  const map2 = T.mapaDiasDoMes(mk);
  assert(T.dotStatuses(map2[hoje]).join(",") === "previsto,extra", "plantão extra aparece como 🟡 ao lado do 🔵");

  // status muda a bolinha do dia
  const oM = hojeOccs.find(o => o.vinculoId === maria.id);
  oM.status = "trabalhado"; oM.editada = true;
  assert(T.dotStatuses(map[hoje]).includes("trabalhado"), "marcar Trabalhei → bolinha 🟢 no dia");
  const oJ = hojeOccs.find(o => o.vinculoId === joao.id);
  oJ.status = "nao_trabalhado"; oJ.editada = true;
  assert(T.dotStatuses(map[hoje]).includes("nao_trabalhado"), "marcar Não trabalhei → bolinha 🔴 no dia");
  assert(!T.dotStatuses([oJ]).includes("previsto"), "previsto cancelado NÃO continua azul");

  // troca de mês
  const mk2 = mkShift(T, 1);
  const exp2 = new Set([...expectedDays(T, maria, mk2), ...expectedDays(T, joao, mk2)]);
  const act2 = actualDays(T, mk2);
  const miss2 = [...exp2].filter(x => !act2.has(x)).sort(), ext2 = [...act2].filter(x => !exp2.has(x)).sort();
  assert(sameSet(exp2, act2), `troca de mês: bolinhas consistentes no mês seguinte${(miss2.length||ext2.length) ? ` | faltando: ${miss2.slice(0,4)} | inesperados: ${ext2.slice(0,4)}` : ""}`);
  T.syncAll();
}
// ============ [C] BORDAS DE MÊS + VIRADA DE ANO ============
console.log("\n[C] Início/fim do mês e virada de ano");
{
  const T = freshApp(true);
  const [y, m] = T.mkey(new Date()).split("-").map(Number);
  const lastKey = T.dkey(new Date(y, m, 0));
  // 12h no último dia do mês → bolinha só nele
  const v1 = mkVinc(T, "Ana", {trab:12,folga:36}, "07:00","19:00", 200);
  v1.dataInicial = lastKey; T.db.vinculos.push(v1); T.syncVinculo(v1);
  if(Date.now() < T.datetimeOf(lastKey, "19:00").getTime()){
    const act = actualDays(T, T.mkey(new Date()));
    assert(act.has(lastKey) && act.size === 1, "plantão no último dia do mês: 🔵 só nele (não vaza para o mês seguinte)");
  }
  // 24h no último dia → continuação no dia 1 do mês seguinte
  const v2 = mkVinc(T, "Bia", {trab:24,folga:48}, "07:00","07:00", 300);
  v2.dataInicial = lastKey; T.db.vinculos.push(v2); T.syncVinculo(v2);
  const act2 = actualDays(T, mkShift(T, 1));
  const dia1 = T.dkey(new Date(y, m, 1));
  assert(act2.has(dia1), "plantão 24h do fim do mês → bolinha de continuação no dia 1 do mês seguinte");

  // virada de ano: plantão 31/12 19:00 → 01/01 07:00 (injetado como dado real salvo)
  const decKey = `${y}-12-31`;
  const ini = T.datetimeOf(decKey, "19:00"); const fim = new Date(ini.getTime() + 12*3600000);
  T.db.ocorrencias.push({ id:"anonatal", vinculoId:null, extra:true, paciente:"Réveillon", cooperativa:"Alfa",
    inicioISO:ini.getTime(), fimISO:fim.getTime(), status:"previsto", editada:false, obs:"", valor:500,
    criadoEm:Date.now(), atualizadoEm:Date.now() });
  T.syncAll();
  const mapDec = T.mapaDiasDoMes(`${y}-12`);
  const mapJan = T.mapaDiasDoMes(`${y+1}-01`);
  assert((mapDec[decKey] || []).some(o => o.id === "anonatal"), "31/dez tem bolinha");
  assert((mapJan[`${y+1}-01-01`] || []).some(o => o.id === "anonatal"), "01/jan tem bolinha de continuação (virada de ano)");
}
// ============ [D] PERSISTÊNCIA (fechar e reabrir) ============
console.log("\n[D] Persistência local (fechar e reabrir o aplicativo)");
{
  const T = freshApp(false); // mantém o storage gravado na seção anterior
  const antesV = T.db.vinculos.length, antesO = T.db.ocorrencias.length;
  const antesMap = JSON.stringify([...actualDays(T, mkShift(T, 1))].sort());
  const T2 = freshApp(false); // "reabrir o app"
  assert(T2.db.vinculos.length === antesV && T2.db.ocorrencias.length === antesO,
    `vínculos (${antesV}) e ocorrências (${antesO}) intactos após reabrir`);
  assert(JSON.stringify([...actualDays(T2, mkShift(T2, 1))].sort()) === antesMap, "calendário idêntico após reabrir");
}

// ============ [E] 24x72 — MAPA DE TRABALHO E FOLGA EXPLÍCITO (exemplo do documento) ============
console.log("\n[E] Escala 24x72 — trabalho a cada 4 dias, folga nos dias intermediários");
{
  const T = freshApp(true);
  const v = mkVinc(T, "Carol", {trab:24,folga:72}, "07:00","07:00", 280);
  T.db.vinculos.push(v); T.syncVinculo(v);
  const mk = T.mkey(new Date());
  const map = T.mapaDiasDoMes(mk);
  // dias de INÍCIO de plantão (não continuação), pela regra do motor
  const starts = Object.keys(map).filter(dk => map[dk].some(o => T.dkey(new Date(o.inicioISO)) === dk)).sort();
  assert(starts.length >= 3, `dias de trabalho calculados: ${starts.slice(0,4).join(", ")}…`);
  const a = T.parseKey(starts[0]), b = T.parseKey(starts[1]);
  const diasEntre = Math.round((b-a)/86400000);
  assert(diasEntre === 4, `intervalo de 4 dias entre plantões (24h trabalha + 72h folga) — obtido ${diasEntre}`);
  // dia seguinte ao plantão = continuação (ela ainda está em plantão) → tem bolinha
  const cont = T.dkey(new Date(a.getTime() + 86400000));
  assert(actualDays(T, mk).has(cont), `continuação em ${cont} → bolinha (ela ainda está trabalhando)`);
  // dias 3 e 4 = folga real → sem bolinha
  for(const i of [2,3]){
    const folga = T.dkey(new Date(a.getTime() + i*86400000));
    assert(!actualDays(T, mk).has(folga), `folga em ${folga} → sem bolinha`);
  }
}

console.log(`\n${pass} testes passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);



