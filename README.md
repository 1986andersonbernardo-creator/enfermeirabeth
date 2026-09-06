# 👩‍⚕️ Enfermeira BETH

**Controle inteligente de plantões** para profissionais de enfermagem.

Cadastre seus vínculos (paciente + cooperativa + valor + escala) **uma única vez** e o aplicativo monta seu calendário automaticamente, mostrando o que está **previsto**, o que você **realmente trabalhou** e **quanto deve receber**.

## ✨ Funcionalidades

- 📅 **Calendário automático** — motor de escalas (12x36, 24x48, 24x72, 12x12 e personalizadas)
- 🟢 **Status por plantão** — Previsto / Trabalhei / Não trabalhei / Extra
- ➕ **Plantões extras** avulsos, sem escala
- 💰 **Financeiro** — previsto vs. realizado, com filtros por mês, paciente, cooperativa e período
- ⚠️ **Aviso de conflito** de horários sobrepostos
- 📝 **Observações** por plantão e por dia
- 📲 **PWA instalável** — adiciona à tela inicial do celular
- 🔒 **100% offline e privado** — sem login, sem servidor: os dados ficam apenas no seu celular
- 💾 **Backup** — exportar/importar seus dados em JSON
- 🆘 **Suporte** via WhatsApp

## 🚀 Como usar

1. Acesse a URL do app (GitHub Pages) no celular
2. Toque em **📲 Adicionar ao celular** (ou Compartilhar → "Adicionar à Tela de Início" no iPhone)
3. Pronto — funciona offline depois de instalada

## 🛠️ Tecnologia

Aplicação **single-file** (HTML + CSS + JS, zero dependências e zero build) + PWA nativo (`manifest.json`, service worker). Armazenamento 100% local (`localStorage`) com exportação de backup.

## 🌐 Publicação (GitHub Pages)

1. `Settings → Pages`
2. Source: `Deploy from a branch`
3. Branch: `main` / pasta `/ (root)`
4. O HTTPS do Pages habilita a instalação do PWA

## 🧪 Testes

```
node dev-test.mjs
```

Valida o motor de escalas, preservação de histórico, financeiro e detecção de conflitos.

---

*Feito com 💙 para a Enfermeira Bete e todas as profissionais da enfermagem.*
