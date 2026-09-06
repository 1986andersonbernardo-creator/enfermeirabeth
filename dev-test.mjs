// Teste de lógica do Enfermeira Beth — roda com: node dev-test.mjs
import fs from "fs";

const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// ---- stubs de browser ----
const fakeEl = () => ({ classList:{ add(){}, remove(){}, toggle(){} }, innerHTML:"", value:"", textContent:"", style:{}, files:[] });
globalThis.window = { addEventListener(){}, matchMedia: () => ({ matches:false }) };
globalThis.document = {
  hidden:false,
  addEventListener(){},
  querySelectorAll: () => [],
  getElementById: () => fakeEl(),
};
globalThis.localStorage = { _s:{}, getItem(k){ return this._s[k] ?? null; }, setItem(k,v){ this._s[k]=v; }, removeItem(k){ delete this._s[k]; } };
Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
globalThis.confirm = () => false;
globalThis.location = { href:"http://localhost/" };

const fn = new Function(js + `
;globalThis.__T = { get db(){ return db; }, syncVinculo, syncAll, resyncAfterEdit, duracaoHoras, financasMes,
  conflitosNoDia, valorDe, ocorrenciasDoDia, mapaDiasDoMes, todayKey, mkey, datetimeOf, uid };
`);
fn.call(globalThis);
const T = globalThis.__T;

let ok = true;
const assert = (c, m) => { if(c) console.log("  ok -", m); else { ok = false; console.error("  FALHOU -", m); } };

const hoje = T.todayKey();
const mk = T.mkey(new Date());

// ===== 1. Motor de escalas: 12x36 =====
console.log("\n[1] Motor de escalas 12x36 (07:00→19:00, R$180)");
const v1 = { id:"t1", paciente:"Maria", cooperativa:"Alfa", valorPorPlantao:180,
  horaInicio:"07:00", horaFim:"19:00", dataInicial:hoje, escala:{trab:12,folga:36}, ativo:true, criadoEm:Date.now() };
T.db.vinculos.push(v1);
const n1 = T.syncVinculo(v1);
const occs1 = T.db.ocorrencias.filter(o => o.vinculoId === "t1").sort((a,b) => a.inicioISO - b.inicioISO);
assert(n1 > 20, `gerou ${n1} ocorrências previstas em ~60 dias`);
assert(occs1.every(o => new Date(o.inicioISO).getHours() === 7), "todas começam às 07:00");
assert(occs1.every(o => new Date(o.fimISO).getHours() === 19), "todas terminam às 19:00");
const gap = (occs1[1].inicioISO - occs1[0].inicioISO) / 3600000;
assert(gap === 48, `intervalo entre plantões = ${gap}h (esperado 48h)`);
assert(T.duracaoHoras(v1) === 12, "duração do plantão = 12h");

// ===== 2. Idempotência (sem duplicação) =====
console.log("\n[2] Idempotência do motor");
T.syncVinculo(v1); T.syncAll();
const occs1b = T.db.ocorrencias.filter(o => o.vinculoId === "t1");
assert(occs1b.length === occs1.length, `sem duplicação após resync (${occs1b.length})`);

// ===== 3. Status + preservação de histórico =====
console.log("\n[3] Preservação de histórico ao editar escala");
const o0 = occs1[0];
o0.status = "trabalhado"; o0.editada = true;
// marca o 2º como não trabalhado
const o1 = occs1[1];
o1.status = "nao_trabalhado"; o1.editada = true;
// muda a escala para 24x72 e regera
v1.escala = { trab:24, folga:72 };
T.resyncAfterEdit(v1);
const still0 = T.db.ocorrencias.find(o => o.id === o0.id);
const still1 = T.db.ocorrencias.find(o => o.id === o1.id);
assert(still0 && still0.status === "trabalhado", "plantão trabalhado preservado");
assert(still1 && still1.status === "nao_trabalhado", "plantão 'não trabalhei' preservado");
const futuros = T.db.ocorrencias.filter(o => o.vinculoId === "t1" && o.status === "previsto");
const gapFut = futuros.length >= 2 ? (futuros.sort((a,b)=>a.inicioISO-b.inicioISO)[1].inicioISO - futuros[0].inicioISO)/3600000 : null;
assert(gapFut === 96, `novos previstos seguem escala nova 24x72 (intervalo ${gapFut}h)`);

// ===== 4. Financeiro =====
console.log("\n[4] Financeiro do mês");
const fin = T.financasMes(mk);
assert(fin.countTrab === 1 && fin.valorTrab === 180, `realizado: ${fin.countTrab} plantão / R$ ${fin.valorTrab}`);
assert(fin.countPrev > 0 && fin.valorPrev === fin.countPrev * 180, `previsto: ${fin.countPrev} plantões / R$ ${fin.valorPrev} (R$180 cada)`);

// ===== 5. Conflito de horários =====
console.log("\n[5] Conflito de horários");
const iniC = T.datetimeOf(hoje, "08:00");
const fimC = T.datetimeOf(hoje, "20:00");
if(fimC <= iniC) fimC.setDate(fimC.getDate()+1);
T.db.ocorrencias.push({ id:T.uid(), vinculoId:null, extra:true, paciente:"Joana", cooperativa:"Beta",
  inicioISO:iniC.getTime(), fimISO:fimC.getTime(), status:"extra", editada:true, obs:"", valor:250,
  criadoEm:Date.now(), atualizadoEm:Date.now() });
const conflitos = T.conflitosNoDia(hoje);
assert(conflitos.length >= 1, `detectada sobreposição no dia (${conflitos.length} par(es))`);

// ===== 6. Plantão 24h cruzando meia-noite =====
console.log("\n[6] Plantão 24h (07:00→07:00)");
const v2 = { id:"t2", paciente:"Carlos", cooperativa:"Alfa", valorPorPlantao:300,
  horaInicio:"07:00", horaFim:"07:00", dataInicial:hoje, escala:{trab:24,folga:48}, ativo:true, criadoEm:Date.now() };
T.db.vinculos.push(v2);
T.syncVinculo(v2);
const occ2 = T.db.ocorrencias.filter(o => o.vinculoId === "t2").sort((a,b)=>a.inicioISO-b.inicioISO)[0];
assert(Math.round((occ2.fimISO - occ2.inicioISO)/3600000) === 24, "duração 24h");
const amanha = new Date(T.datetimeOf(hoje,"12:00").getTime() + 86400000);
const diaSeg = `${amanha.getFullYear()}-${String(amanha.getMonth()+1).padStart(2,"0")}-${String(amanha.getDate()).padStart(2,"0")}`;
const noDiaSeg = T.ocorrenciasDoDia(diaSeg);
assert(noDiaSeg.some(o => o.vinculoId === "t2"), "plantão 24h aparece no dia seguinte (continuação)");
const mapa = T.mapaDiasDoMes(mk);
assert((mapa[hoje]||[]).some(o => o.vinculoId === "t2"), "plantão 24h marcado no dia inicial");

console.log("\n" + (ok ? "✅ TODOS OS TESTES PASSARAM" : "❌ HÁ FALHAS"));
process.exit(ok ? 0 : 1);
