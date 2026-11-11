/* Painel admin: lê e grava data/rifa.json pela API do GitHub com o token do organizador. */
(function () {
  'use strict';

  var R = window.Rifa;
  var $ = function (id) { return document.getElementById(id); };
  var ARQUIVO = 'data/rifa.json';
  var K_REPO = 'rifa.admin.repo';
  var K_TOKEN = 'rifa.admin.token';

  var S = {
    modo: null,          // 'github' | 'teste'
    owner: '', repo: '', branch: 'main', token: '',
    sha: null,
    original: null,      // última versão publicada
    draft: null,         // versão sendo editada
    sel: new Set(),
    celulas: []
  };

  /* ---------- armazenamento local (só credenciais) ---------- */

  function lsGet(store, k) { try { return window[store].getItem(k); } catch (e) { return null; } }
  function lsSet(store, k, v) { try { window[store].setItem(k, v); } catch (e) { /* ignora */ } }
  function lsDel(store, k) { try { window[store].removeItem(k); } catch (e) { /* ignora */ } }

  function detectarRepo() {
    var host = location.hostname;
    if (/\.github\.io$/i.test(host)) {
      var owner = host.split('.')[0];
      var seg = location.pathname.split('/').filter(Boolean)[0];
      var repo = seg && !/\.html$/i.test(seg) ? seg : owner + '.github.io';
      return { owner: owner, repo: repo, branch: 'main' };
    }
    return null;
  }

  /* ---------- API do GitHub ---------- */

  function api(caminho, opcoes) {
    opcoes = opcoes || {};
    var headers = {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + S.token,
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (opcoes.body) headers['Content-Type'] = 'application/json';
    return fetch('https://api.github.com' + caminho, {
      method: opcoes.method || 'GET',
      headers: headers,
      body: opcoes.body,
      cache: 'no-store'
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (corpo) {
        if (!res.ok) {
          var err = new Error((corpo && corpo.message) || ('HTTP ' + res.status));
          err.status = res.status;
          throw err;
        }
        return corpo;
      });
    });
  }

  function caminhoArquivo() {
    return '/repos/' + encodeURIComponent(S.owner) + '/' + encodeURIComponent(S.repo) + '/contents/' + ARQUIVO;
  }

  function b64ParaTexto(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function textoParaB64(texto) {
    var bytes = new TextEncoder().encode(texto);
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function buscarRemoto() {
    return api(caminhoArquivo() + '?ref=' + encodeURIComponent(S.branch)).then(function (j) {
      return { sha: j.sha, data: R.sanitizar(JSON.parse(b64ParaTexto(j.content))) };
    });
  }

  function mensagemErro(e) {
    if (e.status === 401) return 'Token inválido ou expirado.';
    if (e.status === 403) return 'O token não tem permissão de escrita (Contents: Read and write) neste repositório.';
    if (e.status === 404) return 'Repositório, branch ou arquivo data/rifa.json não encontrado — ou o token não tem acesso a ele.';
    return 'Erro: ' + e.message;
  }

  /* ---------- login ---------- */

  function iniciar() {
    var salvo = null;
    try { salvo = JSON.parse(lsGet('localStorage', K_REPO) || 'null'); } catch (e) { salvo = null; }
    var repo = salvo || detectarRepo() || { owner: '', repo: '', branch: 'main' };
    $('in-owner').value = repo.owner || '';
    $('in-repo').value = repo.repo || '';
    $('in-branch').value = repo.branch || 'main';

    var token = lsGet('sessionStorage', K_TOKEN) || lsGet('localStorage', K_TOKEN);
    if (token && repo.owner && repo.repo) {
      $('in-token').value = token;
      $('in-lembrar').checked = !!lsGet('localStorage', K_TOKEN);
      entrar();
    }
  }

  function entrar() {
    var erro = $('login-erro');
    erro.hidden = true;
    S.owner = $('in-owner').value.trim();
    S.repo = $('in-repo').value.trim();
    S.branch = $('in-branch').value.trim() || 'main';
    S.token = $('in-token').value.trim();
    if (!R.repoValido(S.owner + '/' + S.repo)) {
      erro.textContent = 'Usuário ou repositório inválido.';
      erro.hidden = false;
      return;
    }
    S.modo = 'github';
    buscarRemoto().then(function (r) {
      lsSet('localStorage', K_REPO, JSON.stringify({ owner: S.owner, repo: S.repo, branch: S.branch }));
      if ($('in-lembrar').checked) { lsSet('localStorage', K_TOKEN, S.token); lsDel('sessionStorage', K_TOKEN); }
      else { lsSet('sessionStorage', K_TOKEN, S.token); lsDel('localStorage', K_TOKEN); }
      $('in-token').value = '';
      abrirPainel(r.data, r.sha);
    }).catch(function (e) {
      S.modo = null;
      erro.textContent = mensagemErro(e);
      erro.hidden = false;
    });
  }

  function entrarModoTeste() {
    fetch(ARQUIVO + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        S.modo = 'teste';
        abrirPainel(R.sanitizar(j), null);
      })
      .catch(function (e) {
        $('login-erro').textContent = 'Não consegui ler ' + ARQUIVO + ': ' + e.message;
        $('login-erro').hidden = false;
      });
  }

  function sair() {
    if (temPendencias() && !confirm('Há alterações não publicadas. Sair mesmo assim?')) return;
    lsDel('sessionStorage', K_TOKEN);
    lsDel('localStorage', K_TOKEN);
    S.token = '';
    S.modo = null;
    S.original = S.draft = null;
    location.reload();
  }

  function abrirPainel(data, sha) {
    S.original = data;
    S.draft = R.clonar(data);
    S.sha = sha;
    S.sel.clear();
    $('tela-login').hidden = true;
    $('tela-painel').hidden = false;
    $('btn-sair').hidden = false;
    $('modo-info').textContent = S.modo === 'teste'
      ? 'Modo teste — nada é salvo'
      : S.owner + '/' + S.repo + ' (' + S.branch + ')';
    montarGrade();
    renderTudo();
  }

  /* ---------- diferenças e publicação ---------- */

  function igual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function diferencas() {
    var dif = { numeros: [], config: [] };
    if (!S.original) return dif;
    var on = S.original.numeros, dn = S.draft.numeros;
    var chaves = {};
    Object.keys(on).forEach(function (k) { chaves[k] = true; });
    Object.keys(dn).forEach(function (k) { chaves[k] = true; });
    Object.keys(chaves).map(Number).sort(function (a, b) { return a - b; }).forEach(function (n) {
      var a = on[String(n)], b = dn[String(n)];
      if (!igual(a, b)) dif.numeros.push({ n: n, antes: a, depois: b });
    });
    var oc = S.original.config, dc = S.draft.config;
    Object.keys(Object.assign({}, oc, dc)).forEach(function (k) {
      if (!igual(oc[k], dc[k])) dif.config.push(k);
    });
    return dif;
  }

  function temPendencias() {
    if (!S.draft) return false;
    var d = diferencas();
    return d.numeros.length > 0 || d.config.length > 0;
  }

  function descreverEntrada(e) {
    if (!e) return 'disponível';
    return e.status + ' ' + e.ig;
  }

  function mensagemCommit(dif) {
    var total = S.draft.config.totalNumeros;
    var grupos = {};
    dif.numeros.forEach(function (d) {
      var chave = d.depois ? d.depois.status + ' → ' + d.depois.ig : 'liberado';
      (grupos[chave] = grupos[chave] || []).push(R.pad(d.n, total));
    });
    var linhas = Object.keys(grupos).map(function (k) {
      var partes = k.split(' → ');
      return partes[0] + ': ' + grupos[k].join(', ') + (partes[1] ? ' → ' + partes[1] : '');
    });
    if (dif.config.length) linhas.push('config: ' + dif.config.join(', '));
    var titulo = linhas.length === 1 ? linhas[0] : 'Rifa: ' + linhas.length + ' tipos de alteração';
    if (titulo.length > 72) titulo = 'Rifa: ' + dif.numeros.length + ' número(s) alterado(s)' + (dif.config.length ? ' + config' : '');
    return titulo + (linhas.length > 1 || titulo !== linhas[0] ? '\n\n' + linhas.join('\n') : '');
  }

  function limparReservasVencidas(data) {
    var agora = Date.now();
    var removidos = 0;
    Object.keys(data.numeros).forEach(function (k) {
      var e = data.numeros[k];
      if (e.status === 'reservado' && R.msRestantesReserva(e, data.config, agora) <= 0) {
        delete data.numeros[k];
        removidos++;
      }
    });
    return removidos;
  }

  function publicar() {
    if (S.modo !== 'github') { toast('Modo teste: use “Baixar JSON”.'); return; }
    limparReservasVencidas(S.draft);
    S.draft.config.repositorio = S.owner + '/' + S.repo;
    var dif = diferencas();
    if (!dif.numeros.length && !dif.config.length) { renderTudo(); toast('Nada para publicar.'); return; }

    var botao = $('btn-publicar');
    botao.disabled = true;
    botao.textContent = 'Publicando…';
    var corpo = {
      message: mensagemCommit(dif),
      content: textoParaB64(JSON.stringify(S.draft, null, 2) + '\n'),
      sha: S.sha,
      branch: S.branch
    };
    api(caminhoArquivo(), { method: 'PUT', body: JSON.stringify(corpo) })
      .then(function (r) {
        S.sha = r.content.sha;
        S.original = R.clonar(S.draft);
        renderTudo();
        toast('Publicado! ✅ O site atualiza em cerca de 1 minuto.');
      })
      .catch(function (e) {
        if (e.status === 409 || e.status === 422) return mesclarComRemoto();
        toast(mensagemErro(e));
      })
      .then(function () {
        botao.textContent = 'Publicar alterações';
        renderPendentes();
      });
  }

  /** O arquivo mudou em outro lugar: reaplica só o que foi alterado aqui sobre a versão nova. */
  function mesclarComRemoto() {
    var dif = diferencas();
    return buscarRemoto().then(function (r) {
      var novo = R.clonar(r.data);
      dif.numeros.forEach(function (d) {
        if (d.depois) novo.numeros[String(d.n)] = d.depois;
        else delete novo.numeros[String(d.n)];
      });
      dif.config.forEach(function (k) { novo.config[k] = S.draft.config[k]; });
      S.original = r.data;
      S.sha = r.sha;
      S.draft = novo;
      renderTudo();
      toast('O arquivo foi alterado em outro lugar. Suas alterações foram reaplicadas — confira e publique de novo.');
    }).catch(function (e) { toast(mensagemErro(e)); });
  }

  function recarregar() {
    if (temPendencias() && !confirm('Descartar alterações não publicadas e recarregar?')) return;
    if (S.modo === 'teste') { entrarModoTeste(); return; }
    buscarRemoto().then(function (r) { abrirPainel(r.data, r.sha); toast('Dados atualizados.'); })
      .catch(function (e) { toast(mensagemErro(e)); });
  }

  function descartar() {
    if (!confirm('Descartar todas as alterações não publicadas?')) return;
    S.draft = R.clonar(S.original);
    S.sel.clear();
    renderTudo();
  }

  function baixarJson() {
    var blob = new Blob([JSON.stringify(S.draft, null, 2) + '\n'], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = R.el('a', { href: url, download: 'rifa.json' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- seleção de números ---------- */

  function interpretarNumeros(texto, total) {
    var nums = [], erros = [];
    String(texto || '').split(/[\s,;]+/).forEach(function (tok) {
      if (!tok) return;
      var m = /^(\d+)(?:-(\d+))?$/.exec(tok);
      if (!m) { erros.push(tok); return; }
      var a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
      if (a > b) { var t = a; a = b; b = t; }
      if (a < 1 || b > total || b - a > total) { erros.push(tok); return; }
      for (var n = a; n <= b; n++) nums.push(n);
    });
    return { nums: nums, erros: erros };
  }

  function comprimir(nums) {
    var ord = nums.slice().sort(function (a, b) { return a - b; });
    var partes = [];
    for (var i = 0; i < ord.length; i++) {
      var ini = ord[i];
      while (i + 1 < ord.length && ord[i + 1] === ord[i] + 1) i++;
      partes.push(ini === ord[i] ? String(ini) : ini + '-' + ord[i]);
    }
    return partes.join(', ');
  }

  function selecionados() {
    return Array.from(S.sel).sort(function (a, b) { return a - b; });
  }

  function sincronizarCampoNumeros() {
    $('in-nums').value = comprimir(selecionados());
  }

  /* ---------- ações nos números ---------- */

  function exigirSelecao() {
    var nums = selecionados();
    if (!nums.length) toast('Selecione pelo menos um número.');
    return nums;
  }

  function lerHandle(obrigatorio) {
    var bruto = $('in-ig').value;
    var h = R.normalizarHandle(bruto);
    if (!h) {
      if (obrigatorio) toast('Digite o @ do comprador.');
      return obrigatorio ? null : '';
    }
    if (!R.handleValido(h)) { toast('@ inválido: use apenas letras, números, ponto e _ (até 30).'); return null; }
    return h;
  }

  function avisoEncerrada() {
    return S.draft.config.status === 'aberta' ||
      confirm('As vendas estão marcadas como ' + S.draft.config.status + '. Alterar números mesmo assim?');
  }

  function fimDeAcao(msg) {
    S.sel.clear();
    sincronizarCampoNumeros();
    renderLeve();
    if (msg) toast(msg);
  }

  function reservar() {
    var nums = exigirSelecao(); if (!nums.length) return;
    var h = lerHandle(true); if (!h) return;
    if (!avisoEncerrada()) return;
    var c = S.draft.config, agora = Date.now();
    var conflitos = [], jaPagos = [];
    nums.forEach(function (n) {
      var e = S.draft.numeros[String(n)];
      var st = R.statusEfetivo(e, c, agora);
      if (st === 'pago' && e.ig === h) jaPagos.push(n);
      else if (st !== 'disponivel' && e.ig !== h) conflitos.push(R.pad(n, c.totalNumeros) + ' (' + e.ig + ')');
    });
    if (conflitos.length && !confirm('Estes números já estão com outra pessoa:\n' + conflitos.join(', ') + '\n\nSubstituir pela reserva de ' + h + '?')) return;
    var em = new Date(agora).toISOString();
    nums.forEach(function (n) {
      if (jaPagos.indexOf(n) !== -1) return;
      S.draft.numeros[String(n)] = { ig: h, status: 'reservado', em: em };
    });
    fimDeAcao((nums.length - jaPagos.length) + ' número(s) reservado(s) para ' + h + '. Lembre de publicar.');
  }

  function pagar() {
    var nums = exigirSelecao(); if (!nums.length) return;
    var h = lerHandle(false); if (h === null) return;
    if (!avisoEncerrada()) return;
    var c = S.draft.config, agora = Date.now();
    var semIg = [], conflitos = [];
    nums.forEach(function (n) {
      var e = S.draft.numeros[String(n)];
      if (!h && !e) semIg.push(R.pad(n, c.totalNumeros));
      if (h && e && e.ig !== h && R.statusEfetivo(e, c, agora) !== 'disponivel') {
        conflitos.push(R.pad(n, c.totalNumeros) + ' (' + e.ig + ')');
      }
    });
    if (semIg.length) { toast('Digite o @ — estes números não têm reserva: ' + semIg.join(', ')); return; }
    if (conflitos.length && !confirm('Estes números estão com outra pessoa:\n' + conflitos.join(', ') + '\n\nMarcar como pagos por ' + h + '?')) return;
    var em = new Date(agora).toISOString();
    nums.forEach(function (n) {
      var e = S.draft.numeros[String(n)];
      var ig = h || e.ig;
      var mesmoPago = e && e.status === 'pago' && e.ig === ig;
      S.draft.numeros[String(n)] = { ig: ig, status: 'pago', em: mesmoPago ? e.em : em };
    });
    fimDeAcao(nums.length + ' número(s) marcado(s) como pago(s). Lembre de publicar.');
  }

  function liberar() {
    var nums = exigirSelecao(); if (!nums.length) return;
    var pagos = nums.filter(function (n) {
      var e = S.draft.numeros[String(n)];
      return e && e.status === 'pago';
    });
    if (pagos.length && !confirm('Atenção: ' + pagos.length + ' número(s) já estão PAGOS. Liberar mesmo assim?')) return;
    nums.forEach(function (n) { delete S.draft.numeros[String(n)]; });
    fimDeAcao(nums.length + ' número(s) liberado(s). Lembre de publicar.');
  }

  function selecionarDoHandle() {
    var h = lerHandle(true); if (!h) return;
    S.sel.clear();
    Object.keys(S.draft.numeros).forEach(function (k) {
      if (S.draft.numeros[k].ig === h) S.sel.add(parseInt(k, 10));
    });
    sincronizarCampoNumeros();
    renderLeve();
    toast(S.sel.size ? S.sel.size + ' número(s) de ' + h + ' selecionado(s).' : 'Nenhum número com ' + h + '.');
  }

  /* ---------- datas, status, hash, resultado ---------- */

  function paraInput(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    return new Date(t - 3 * 3600000).toISOString().slice(0, 16);
  }

  function deInput(v) {
    return v ? v + ':00-03:00' : null;
  }

  function adiar() {
    var c = S.draft.config;
    if (c.adiado) return;
    if (!confirm('Adiar o sorteio para ' + R.formatarData(c.dataMaximaAdiamento) + '? Isso só pode ser feito uma vez.')) return;
    c.adiado = true;
    renderTudo();
    toast('Sorteio adiado. Lembre de publicar e avisar no Instagram.');
  }

  function encerrar() {
    var c = S.draft.config;
    var removidos = limparReservasVencidas(S.draft);
    var res = R.resumo(S.draft, Date.now());
    var msg = 'Encerrar as vendas e gerar o hash da lista final?\n\n' + res.pagos + ' número(s) pago(s) entram na lista.';
    if (res.reservados) msg += '\n⚠️ ' + res.reservados + ' reserva(s) ainda não paga(s) NÃO entram na lista e serão removidas.';
    if (!confirm(msg)) { renderLeve(); return; }
    if (removidos) toast(removidos + ' reserva(s) vencida(s) removida(s).');
    Object.keys(S.draft.numeros).forEach(function (k) {
      if (S.draft.numeros[k].status !== 'pago') delete S.draft.numeros[k];
    });
    c.status = 'encerrada';
    R.sha256Hex(R.listaCanonica(S.draft)).then(function (h) {
      if (!h) { toast('Este navegador não conseguiu calcular o hash (use HTTPS).'); return; }
      c.hashListaFinal = h;
      renderTudo();
      toast('Vendas encerradas e hash gerado. Agora clique em “Publicar alterações”.');
    });
  }

  function renderHashAdmin() {
    var c = S.draft.config;
    var code = $('hash-admin');
    if (!c.hashListaFinal) { code.textContent = ''; return; }
    code.textContent = c.hashListaFinal;
    R.sha256Hex(R.listaCanonica(S.draft)).then(function (h) {
      if (h && h !== c.hashListaFinal) code.textContent = c.hashListaFinal + '  ⚠️ a lista mudou depois do hash — gere de novo';
    });
  }

  function atualizarResultado() {
    var c = S.draft.config;
    var n = parseInt($('res-numero').value, 10);
    var video = $('res-video').value.trim();
    if (!n && !video) c.resultado = null;
    else c.resultado = { numero: n || null, videoUrl: video || null };
    renderResultadoInfo();
  }

  function renderResultadoInfo() {
    var c = S.draft.config;
    var r = c.resultado;
    var info = $('res-info');
    if (!r || !r.numero) { info.textContent = 'Preencha depois da live e mude o status para “Sorteada”.'; return; }
    var e = S.draft.numeros[String(r.numero)];
    info.textContent = e && e.status === 'pago'
      ? 'Ganhador: ' + e.ig + ' 🎉'
      : '⚠️ O número ' + R.pad(r.numero, c.totalNumeros) + ' não foi vendido — sorteie novamente.';
    if (r.videoUrl && !/^https:\/\/(www\.)?instagram\.com\//i.test(r.videoUrl)) {
      info.textContent += ' · O link do vídeo precisa começar com https://www.instagram.com/';
    }
  }

  /* ---------- formulário de config ---------- */

  var CAMPOS = [
    { k: 'titulo', t: 'texto' }, { k: 'premio', t: 'texto' }, { k: 'foto', t: 'texto' },
    { k: 'pixChave', t: 'texto' }, { k: 'pixNomeRecebedor', t: 'texto' }, { k: 'instagram', t: 'ig' },
    { k: 'precoNumero', t: 'numero' }, { k: 'reservaMinutos', t: 'numero' },
    { k: 'historia', t: 'texto' }, { k: 'descricaoPremio', t: 'texto' },
    { k: 'dataLimite', t: 'data' }, { k: 'dataMaximaAdiamento', t: 'data' }, { k: 'dataSorteioAntecipado', t: 'data' },
    { k: 'status', t: 'texto' }
  ];

  function renderForm() {
    var c = S.draft.config;
    CAMPOS.forEach(function (f) {
      var input = $('cfg-' + f.k);
      if (f.t === 'data') input.value = paraInput(c[f.k]);
      else input.value = c[f.k] == null ? '' : String(c[f.k]);
    });
    var r = c.resultado || {};
    $('res-numero').value = r.numero || '';
    $('res-numero').max = String(c.totalNumeros);
    $('res-video').value = r.videoUrl || '';
    renderResultadoInfo();
    renderHashAdmin();
    $('btn-adiar').disabled = !!c.adiado;
    $('adiado-info').textContent = c.adiado ? 'Adiado para ' + R.formatarData(c.dataMaximaAdiamento) : '';
    document.querySelectorAll('[data-min]').forEach(function (s) { s.textContent = String(c.reservaMinutos); });
  }

  function ligarCampos() {
    CAMPOS.forEach(function (f) {
      var input = $('cfg-' + f.k);
      var evento = input.tagName === 'SELECT' || f.t === 'data' ? 'change' : 'input';
      input.addEventListener(evento, function () {
        var c = S.draft.config;
        var v = input.value;
        if (f.t === 'data') c[f.k] = deInput(v);
        else if (f.t === 'numero') { var num = Number(v); if (num > 0) c[f.k] = num; }
        else if (f.t === 'ig') c[f.k] = R.normalizarHandle(v).slice(1);
        else c[f.k] = v;
        if (f.k === 'status' && v === 'aberta' && c.hashListaFinal) {
          c.hashListaFinal = null;
          toast('Vendas reabertas: o hash da lista final foi removido.');
        }
        if (f.k === 'reservaMinutos') renderForm();
        renderLeve();
        if (f.k === 'dataLimite' || f.k === 'dataMaximaAdiamento') renderForm();
      });
    });
    $('res-numero').addEventListener('input', function () { atualizarResultado(); renderPendentes(); });
    $('res-video').addEventListener('input', function () { atualizarResultado(); renderPendentes(); });
  }

  /* ---------- renderização ---------- */

  function montarGrade() {
    var total = S.draft.config.totalNumeros;
    var grade = $('admin-grade');
    grade.replaceChildren();
    S.celulas = [];
    var frag = document.createDocumentFragment();
    for (var n = 1; n <= total; n++) {
      var b = R.el('button', { type: 'button', class: 'num', 'data-n': String(n) }, [
        R.el('span', { class: 'num-n', text: R.pad(n, total) }),
        R.el('span', { class: 'num-ig' })
      ]);
      S.celulas.push(b);
      frag.appendChild(b);
    }
    grade.appendChild(frag);
  }

  function renderGrade() {
    var c = S.draft.config, agora = Date.now();
    S.celulas.forEach(function (b, i) {
      var k = String(i + 1);
      var e = S.draft.numeros[k];
      var st = R.statusEfetivo(e, c, agora);
      var alterado = !igual(S.original.numeros[k], e);
      b.className = 'num ' + st + (S.sel.has(i + 1) ? ' selecionado' : '') + (alterado ? ' alterado' : '');
      var txt = '';
      if (e && st !== 'disponivel') txt = e.ig;
      else if (e && e.status === 'reservado') txt = e.ig + ' (venceu)';
      b.lastChild.textContent = txt;
      b.title = R.pad(i + 1, c.totalNumeros) + (e ? ' — ' + e.status + ' ' + e.ig + (st === 'reservado'
        ? ' (' + Math.ceil(R.msRestantesReserva(e, c, agora) / 60000) + ' min)' : '') : ' — disponível');
    });
  }

  function renderStats() {
    var c = S.draft.config;
    var res = R.resumo(S.draft, Date.now());
    var box = $('admin-stats');
    box.replaceChildren();
    [
      ['Pagos', res.pagos], ['Reservados', res.reservados], ['Disponíveis', res.disponiveis],
      ['Arrecadado', R.formatarBRL(res.pagos * c.precoNumero)]
    ].forEach(function (s) {
      box.appendChild(R.el('div', { class: 'stat' }, [
        R.el('strong', { text: String(s[1]) }), R.el('span', { text: s[0] })
      ]));
    });
    $('aviso-esgotado').hidden = !(res.esgotado && !c.dataSorteioAntecipado && c.status === 'aberta');
  }

  function renderPendentes() {
    var dif = diferencas();
    var qtd = dif.numeros.length + dif.config.length;
    var total = S.draft.config.totalNumeros;
    $('pendente-texto').textContent = qtd
      ? qtd + ' alteração(ões) não publicada(s).'
      : 'Nenhuma alteração pendente.';
    $('barra-pendente').classList.toggle('tem', qtd > 0);
    $('btn-publicar').disabled = !qtd || S.modo !== 'github';
    $('btn-publicar').title = S.modo === 'teste' ? 'Modo teste: use “Baixar JSON”' : '';
    $('btn-descartar').disabled = !qtd;
    var ul = $('pendente-lista');
    ul.replaceChildren();
    dif.numeros.slice(0, 60).forEach(function (d) {
      ul.appendChild(R.el('li', { text: R.pad(d.n, total) + ': ' + descreverEntrada(d.antes) + ' → ' + descreverEntrada(d.depois) }));
    });
    if (dif.numeros.length > 60) ul.appendChild(R.el('li', { text: '… e mais ' + (dif.numeros.length - 60) }));
    dif.config.forEach(function (k) { ul.appendChild(R.el('li', { text: 'config: ' + k + ' alterado' })); });
  }

  function renderSelInfo() {
    var nums = selecionados();
    $('sel-info').textContent = nums.length
      ? nums.length + ' selecionado(s): ' + comprimir(nums)
      : '';
  }

  function renderHandles() {
    var dl = $('admin-handles');
    var set = {};
    Object.keys(S.draft.numeros).forEach(function (k) { set[S.draft.numeros[k].ig] = true; });
    var chave = Object.keys(set).sort().join(' ');
    if (dl.getAttribute('data-chave') === chave) return;
    dl.setAttribute('data-chave', chave);
    dl.replaceChildren();
    Object.keys(set).sort().forEach(function (h) { dl.appendChild(R.el('option', { value: h })); });
  }

  function renderLeve() {
    if (!S.draft) return;
    renderGrade();
    renderStats();
    renderPendentes();
    renderSelInfo();
    renderHandles();
    renderHashAdmin();
    renderResultadoInfo();
  }

  function renderTudo() {
    if (!S.draft) return;
    renderForm();
    renderLeve();
  }

  /* ---------- utilidades ---------- */

  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('visivel');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('visivel'); }, 4200);
  }

  /* ---------- eventos ---------- */

  $('form-login').addEventListener('submit', function (ev) { ev.preventDefault(); entrar(); });
  $('btn-modo-teste').addEventListener('click', entrarModoTeste);
  $('btn-sair').addEventListener('click', sair);
  $('btn-publicar').addEventListener('click', publicar);
  $('btn-descartar').addEventListener('click', descartar);
  $('btn-recarregar').addEventListener('click', recarregar);
  $('btn-baixar').addEventListener('click', baixarJson);
  $('btn-reservar').addEventListener('click', reservar);
  $('btn-pagar').addEventListener('click', pagar);
  $('btn-liberar').addEventListener('click', liberar);
  $('btn-sel-ig').addEventListener('click', selecionarDoHandle);
  $('btn-limpar-sel').addEventListener('click', function () { S.sel.clear(); sincronizarCampoNumeros(); renderLeve(); });
  $('btn-adiar').addEventListener('click', adiar);
  $('btn-encerrar').addEventListener('click', encerrar);
  $('btn-limpar-antecipado').addEventListener('click', function () {
    S.draft.config.dataSorteioAntecipado = null;
    renderTudo();
  });

  $('admin-grade').addEventListener('click', function (ev) {
    var b = ev.target.closest('.num');
    if (!b) return;
    var n = parseInt(b.getAttribute('data-n'), 10);
    if (S.sel.has(n)) S.sel.delete(n); else S.sel.add(n);
    sincronizarCampoNumeros();
    renderLeve();
  });

  $('in-nums').addEventListener('input', function () {
    var r = interpretarNumeros($('in-nums').value, S.draft.config.totalNumeros);
    S.sel = new Set(r.nums);
    renderGrade();
    renderSelInfo();
    if (r.erros.length) $('sel-info').textContent += (r.nums.length ? ' · ' : '') + 'Ignorado: ' + r.erros.join(', ');
  });

  window.addEventListener('beforeunload', function (ev) {
    if (temPendencias()) { ev.preventDefault(); ev.returnValue = ''; }
  });

  ligarCampos();
  setInterval(renderLeve, 30000);
  iniciar();
})();
