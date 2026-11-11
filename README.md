# Rifa da Sorte

Site estático da rifa solidária do **Whisky Gold Bar Bourbon The Original** (500 números a R$ 1,00), hospedado de graça no GitHub Pages.

- O público só **vê** a página. Não existe servidor nem banco de dados para invadir.
- Todos os dados ficam em um único arquivo: [`data/rifa.json`](data/rifa.json).
- Só quem tem permissão de escrita no repositório (você) consegue mudar esse arquivo, pelo painel [`admin.html`](admin.html) ou direto no GitHub.
- Cada alteração vira um commit público, então qualquer pessoa pode conferir o histórico.

## Estrutura

| Arquivo | O que faz |
|---|---|
| `index.html` + `js/app.js` | Página pública: foto, história, prêmio, passo a passo, Pix, grade de números, busca por @, top 3, regras |
| `admin.html` + `js/admin.js` | Painel para reservar, confirmar pagamento, liberar números, editar textos e datas |
| `js/common.js` | Regras compartilhadas (expiração da reserva, ranking, hash) |
| `data/rifa.json` | Os dados da rifa |
| `img/whisky.jpg` | **Coloque aqui a foto do whisky** (de preferência em pé, proporção 4:5) |
| `.github/workflows/pages.yml` | Publica o site automaticamente a cada alteração |

## 1. Publicar no GitHub Pages (uma vez só)

1. Ative a **verificação em duas etapas** na sua conta do GitHub (Settings → Password and authentication).
2. Crie um repositório **público** chamado `rifadasorte` (sem README).
3. Coloque a foto em `img/whisky.jpg`.
4. Na pasta do projeto:
   ```bash
   git init -b main
   git add .
   git commit -m "Rifa da Sorte"
   git remote add origin https://github.com/SEU_USUARIO/rifadasorte.git
   git push -u origin main
   ```
5. No repositório: **Settings → Pages → Source: GitHub Actions**.
6. Em 1–2 minutos o site estará em `https://SEU_USUARIO.github.io/rifadasorte/`.
7. Coloque esse link na bio do Instagram — é o único link oficial.

## 2. Criar o token do painel

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
2. Expiration: 60 dias · Repository access: **Only select repositories** → `rifadasorte`.
3. Repository permissions → **Contents: Read and write** (nada mais).
4. Abra `https://SEU_USUARIO.github.io/rifadasorte/admin.html`, preencha usuário/repositório e cole o token.

O token fica só no seu navegador. Sem ele, o painel não grava nada. Ao terminar a rifa, apague o token no GitHub.

## 3. Rotina de vendas

1. Alguém manda direct com os números → no painel, digite os números (`7, 15, 20-25`) ou toque na grade, digite o @ e clique **Reservar**. Depois **Publicar alterações**.
   A reserva vale 10 minutos. Depois disso o número volta a aparecer como disponível no site sozinho.
2. Chegou o comprovante → selecione os números (ou digite o @ e clique **Selecionar números do @**) → **Marcar como pago** → **Publicar**.
3. Se a pessoa desistir → selecione → **Liberar** → **Publicar**.

Dica: dá para fazer várias alterações e publicar tudo de uma vez. O site atualiza em cerca de 1 minuto.

## 4. Datas

- Sorteio: **01/12/2026 às 20h** (horário de Brasília). Pode ser alterado em “Datas e status”.
- Se não vender tudo: botão **Adiar sorteio** (só funciona uma vez) → passa para **10/12/2026**.
- Se esgotar antes: preencha **Sorteio antecipado** com a nova data.

## 5. Dia do sorteio

1. No painel: **Encerrar vendas e gerar hash** → **Publicar**. O site mostra o hash SHA-256 da lista final e confirma que a lista confere.
2. Na live: mostre o site, leia o hash, abra o [sorteador.com.br](https://sorteador.com.br/) de 1 a 500 e sorteie.
3. Se sair um número não vendido (só acontece se a rifa não esgotar), sorteie de novo, como está nas regras.
4. Depois da live: preencha **Resultado** (número + link do vídeo), mude o status para **Sorteada** → **Publicar**.
5. Deixe o vídeo fixado no Instagram.

## Testar no computador

```bash
python3 -m http.server 8000
```

Abra `http://localhost:8000`. No painel (`/admin.html`), o botão **Testar sem salvar** carrega os dados locais e permite experimentar tudo sem gravar (use **Baixar JSON** para ver o resultado).

## Segurança

- Página sem backend: o único jeito de mudar os números é gravar no repositório.
- Token com permissão mínima (só esse repositório, só conteúdo) e com prazo para expirar.
- Todo texto é inserido na página como texto puro (sem `innerHTML`). Os @ são validados.
- Content-Security-Policy bloqueia scripts de qualquer outro site. Não há scripts de terceiros nem analytics.
- Histórico público de commits mais o hash da lista final: se alguém mudar a lista depois de encerrar, dá para perceber.
- Cuidado com cópias do site com outra chave Pix. A página avisa qual é a chave oficial.
