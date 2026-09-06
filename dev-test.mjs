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
  todayKey, mkey, datetimeOf, parseKey, dkey, uid, saveDB,
  medOcorrenciasHoje, setRegistro, getRegistro, medDesfazerRegistro, statusDe,
  proximaMedicacaoHoje, proximaDoPaciente, medAtivas };`;

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

// ============ [F] MEDICAÇÕES — cadastro, horários, lembretes, administração, histórico ============
console.log("\n[F] Medicações (cadastro, horarios, lembretes, admin, histórico, persistencia)");
{
  const T = freshApp(true);
  const hoje = T.todayKey();
  const maria = mkVinc(T, "Maria", {trab:12,folga:36}, "07:00","19:00", 180);
  T.db.vinculos.push(maria); T.syncVinculo(maria);

  // 1 + 3 + 4: cadastrar medicações com vários horários y flags de lembrete
  maria.medicacoes = [
    { id:"dip", nome:"Dipirona", dose:"500 mg", obs:"Após alimentação", lembrete:true,  ativo:true, horarios:["08:00","14:00","20:00"] },
    { id:"los", nome:"Losartana", dose:"50 mg",  obs:"",                   lembrete:false, ativo:true, horarios:["08:00","20:00"] }
  ];
  T.saveDB();

  // 10: visualizar medicações de hoje (ordenadas por horario)
  const hoy = T.medOcorrenciasHoje(hoje);
  assert(hoy.length === 5, `5 ocorrencias del día (Dipirona×3 + Losartana×2) — obtenidas ${hoy.length}`);
  assert(hoy[0].horario === "08:00" && hoy[0].nome === "Dipirona", "primera med às 08:00 Dipirona");
  assert(hoy[1].horario === "08:00" && hoy[1].nome === "Losartana", "08:00 Losartana (no duplicada en otro bloque)");
  assert(hoy.every(i => i.registro === null), "sin registros aún → todas 'sin estado'");

  // status: próxima vs pendente según la hora actual
  const ahora830 = new Date(); ahora830.setHours(8,30,0,0);
  const dip08 = hoy.find(i => i.nome==="Dipirona" && i.horario==="08:00");
  const dip14 = hoy.find(i => i.nome==="Dipirona" && i.horario==="14:00");
  assert(T.statusDe(dip08, ahora830) === "pendente", "08:00 às 08:30 → 🔵 Pendente (ya pasó)");
  assert(T.statusDe(dip14, ahora830) === "proxima", "14:00 às 08:30 → ⏰ Próxima");

  // 7: marcar como administrada (idempotente, no duplica)
  T.setRegistro(maria.id, "dip", hoje, "08:00", "administrada");
  T.setRegistro(maria.id, "dip", hoje, "08:00", "administrada");
  const regs = T.db.medRegistros.filter(r => r.medId === "dip" && r.horario === "08:00");
  assert(regs.length === 1, `sin duplicar registro (1 de Dipirona 08:00) — hay ${regs.length}`);
  assert(T.getRegistro(maria.id,"dip",hoje,"08:00").marcadoEm > 0, "registro guarda data/hora de marcado");
  const hoy2 = T.medOcorrenciasHoje(hoje);
  const dip08b = hoy2.find(i => i.nome==="Dipirona" && i.horario==="08:00");
  assert(T.statusDe(dip08b, ahora830) === "administrada", "08:00 → 🟢 Administrada tras marcar");

  // 8: no administrada
  T.setRegistro(maria.id, "los", hoje, "08:00", "nao_administrada");
  const los08 = T.medOcorrenciasHoje(hoje).find(i => i.nome==="Losartana" && i.horario==="08:00");
  assert(T.statusDe(los08, ahora830) === "nao_administrada", "08:00 Losartana → 🔴 No administrada");

  // 11: próxima medicação del día (tras admin 08:00) → 14:00 Dipirona
  const prox = T.proximaMedicacaoHoje();
  assert(prox && prox.horario === "14:00" && prox.nome === "Dipirona", `próxima med → 14:00 Dipirona (obtenida ${prox?.horario} ${prox?.nome})`);

  // 5: editar medicamento (cambia horarios y dose)
  const dip = maria.medicacoes.find(m => m.id === "dip");
  dip.dose = "1 g"; dip.horarios = ["08:00","20:00"];
  T.saveDB();
  const hoy3 = T.medOcorrenciasHoje(hoje);
  const dip20 = hoy3.find(i => i.nome==="Dipirona" && i.horario==="20:00");
  assert(dip20 && dip20.dose === "1 g", "edición reflejada (Dipirona 1 g às 20:00)");
  assert(hoy3.filter(i => i.nome === "Dipirona").length === 2, "solo 2 horarios de Dipirona tras editar");

  // 2 + 6: excluir medicamento
  maria.medicacoes = maria.medicacoes.filter(m => m.id !== "los");
  T.saveDB();
  const hoy4 = T.medOcorrenciasHoje(hoje);
  assert(!hoy4.some(i => i.nome === "Losartana"), "Losartana excluida del día");
  assert(T.db.medRegistros.some(r => r.medId === "los"), "histórico de Losartana preservado tras excluir");

  // 4: desactivar lembrete se refleja en la lista
  const dipB = maria.medicacoes.find(m => m.id === "dip");
  dipB.lembrete = false; T.saveDB();
  assert(!T.medOcorrenciasHoje(hoje).find(i => i.medId === "dip").lembrete, "lembrete desactivado → 🔕");

  // 9: histórico consultable (agrupado por fecha)
  assert(T.db.medRegistros.filter(r => r.dataKey === hoje).length >= 2, "histórico del día con ≥2 registros");
  assert(T.getRegistro(maria.id,"dip",hoje,"08:00").status === "administrada", "histórico: 08:00 Dipirona administrada");
  assert(T.getRegistro(maria.id,"los",hoje,"08:00").status === "nao_administrada", "histórico: 08:00 Losartana no administrada");

  // deshacer
  T.medDesfazerRegistro(maria.id,"dip",hoje,"08:00");
  assert(T.getRegistro(maria.id,"dip",hoje,"08:00") === undefined, "deshacer registro lo elimina");

  // 12+13: persistencia al reabrir la app
  const antesRegs = T.db.medRegistros.length, antesMed = maria.medicacoes.length;
  const T2 = freshApp(false);
  const m2 = T2.db.vinculos[0];
  assert(T2.db.medRegistros.length === antesRegs && (m2.medicacoes||[]).length === antesMed,
    `reabrir: ${antesRegs} registros y ${antesMed} meds intactos`);
  assert(T2.medOcorrenciasHoje(T2.todayKey()).length === T.medOcorrenciasHoje(hoje).length,
    "reabrir: mismas medicações del día tras persistencia");
}

console.log(`\n${pass} testes passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);



