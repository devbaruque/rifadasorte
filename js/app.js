/* Página pública: só lê data/rifa.json. Nada aqui grava dados. */
(function () {
  'use strict';

  var R = window.Rifa;
  var $ = function (id) { return document.getElementById(id); };

  var estado = {
    data: null,
    textoBruto: '',
    celulas: [],
    selecionados: new Set(),
    filtro: 'todos',
    busca: '',
    hashCalculadoPara: null
  };

  /* ---------- carregamento ---------- */

  function carregar(inicial) {
    return fetch('data/rifa.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (texto) {
        if (texto === estado.textoBruto) return;
        estado.textoBruto = texto;
        estado.data = R.sanitizar(JSON.parse(texto));
        renderConfig();
        montarGrade();
        atualizar();
        if (inicial) aplicarBuscaDaUrl();
      })
      .catch(function () {
        if (inicial) $('carregando').textContent = 'Não foi possível carregar os números. Atualize a página em instantes.';
      });
  }

  /* ---------- textos fixos vindos da config ---------- */

  function renderConfig() {
    var c = estado.data.config;
    document.title = c.titulo;
    $('titulo').textContent = c.titulo;
    $('preco').textContent = R.formatarBRL(c.precoNumero);

    document.querySelectorAll('[data-cfg]').forEach(function (node) {
      var v = c[node.getAttribute('data-cfg')];
      node.textContent = v == null ? '' : String(v);
    });
    document.querySelectorAll('[data-cfg-data]').forEach(function (node) {
      node.textContent = R.formatarData(c[node.getAttribute('data-cfg-data')]);
    });
    document.querySelectorAll('[data-cfg-preco]').forEach(function (node) {
      node.textContent = R.formatarBRL(c.precoNumero);
    });
    var ig = c.instagram ? '@' + c.instagram : '';
    document.querySelectorAll('[data-cfg-ig]').forEach(function (node) { node.textContent = ig; });
    document.querySelectorAll('[data-ig-link]').forEach(function (node) {
      node.href = R.linkPerfilInstagram(c.instagram);
    });
    $('pix-nome').hidden = !c.pixNomeRecebedor;

    var foto = $('foto');
    var src = typeof c.foto === 'string' && /^img\/[\w.-]+$/.test(c.foto) ? c.foto : 'img/whisky.jpg';
    if (foto.getAttribute('src') !== src) foto.setAttribute('src', src);

    R.preencherParagrafos($('historia-texto'), c.historia);
    R.preencherParagrafos($('premio-texto'), c.descricaoPremio);

    var repoOk = R.repoValido(c.repositorio);
    $('link-historico-wrap').hidden = !repoOk;
    if (repoOk) $('link-historico').href = 'https://github.com/' + c.repositorio + '/commits/HEAD/data/rifa.json';
  }

  /* ---------- grade ---------- */

  function montarGrade() {
    var total = estado.data.config.totalNumeros;
    if (estado.celulas.length === total) return;
    var grade = $('grade');
    grade.replaceChildren();
    estado.celulas = [];
    var frag = document.createDocumentFragment();
    for (var n = 1; n <= total; n++) {
      var btn = R.el('button', { type: 'button', class: 'num', 'data-n': String(n) }, [
        R.el('span', { class: 'num-n', text: R.pad(n, total) }),
        R.el('span', { class: 'num-ig' })
      ]);
      estado.celulas.push(btn);
      frag.appendChild(btn);
    }
    grade.appendChild(frag);
    $('carregando').hidden = true;
  }

  function atualizar() {
    if (!estado.data) return;
    var data = estado.data;
    var c = data.config;
    var agora = Date.now();
    var aberta = c.status === 'aberta';
    var res = R.resumo(data, agora);

    // células
    estado.celulas.forEach(function (btn, i) {
      var n = i + 1;
      var e = data.numeros[String(n)];
      var st = R.statusEfetivo(e, c, agora);
      if (st !== 'disponivel' || !aberta) estado.selecionados.delete(n);
      var selecionado = estado.selecionados.has(n);
      var destacado = !!estado.busca && st !== 'disponivel' && e.ig === estado.busca;
      var oculto = (estado.filtro === 'disponiveis' && st !== 'disponivel') ||
        (estado.filtro === 'vendidos' && st === 'disponivel');

      btn.className = 'num ' + st + (selecionado ? ' selecionado' : '') +
        (destacado ? ' destacado' : '') + (oculto ? ' oculto' : '');
      btn.lastChild.textContent = st === 'disponivel' ? '' : e.ig;
      btn.setAttribute('aria-pressed', selecionado ? 'true' : 'false');
      var rotulo = 'Número ' + R.pad(n, c.totalNumeros) + ': ' +
        (st === 'pago' ? 'pago por ' + e.ig : st === 'reservado' ? 'reservado por ' + e.ig : 'disponível');
      btn.setAttribute('aria-label', rotulo);
      btn.title = rotulo;
    });

    // progresso
    var pct = Math.round((res.pagos / res.total) * 1000) / 10;
    $('progresso-fill').style.width = pct + '%';
    $('progresso-barra').setAttribute('aria-valuemax', String(res.total));
    $('progresso-barra').setAttribute('aria-valuenow', String(res.pagos));
    $('qtd-pagos').textContent = String(res.pagos);
    $('qtd-disponiveis').textContent = String(res.disponiveis);

    renderFaixa(res);
    renderRanking();
    renderHandles(agora);
    renderBusca(false);
    renderSelecao();
    renderResultado();
    renderHash();
    tickContagem();
  }

  function renderFaixa(res) {
    var c = estado.data.config;
    var info = R.infoSorteio(c);
    var faixa = $('faixa-status');
    var texto = '';
    if (c.status === 'sorteada') texto = '🏆 Sorteio realizado! Veja o resultado abaixo.';
    else if (c.status === 'encerrada') texto = '🔒 Vendas encerradas. Sorteio ao vivo no Instagram @' + c.instagram + (info.data ? ' em ' + R.formatarData(info.data) : '') + '.';
    else if (res.esgotado) texto = '🎉 Todas as cotas foram vendidas! Obrigado! O sorteio será antecipado.';
    else if (info.fase === 'adiado') texto = '📅 O sorteio foi adiado para ' + R.formatarData(info.data) + '. Ainda dá tempo de comprar!';
    faixa.textContent = texto;
    faixa.hidden = !texto;
  }

  /* ---------- contagem regressiva ---------- */

  function tickContagem() {
    if (!estado.data) return;
    var info = R.infoSorteio(estado.data.config);
    var box = $('contagem');
    if (info.fase === 'sorteada' || !info.data) { box.hidden = true; return; }
    box.hidden = false;
    var prefixo = info.fase === 'antecipado' ? 'Cotas esgotadas! Sorteio antecipado para '
      : info.fase === 'adiado' ? 'Sorteio adiado para ' : 'Sorteio em ';
    $('contagem-titulo').textContent = prefixo + R.formatarData(info.data);
    var falta = Date.parse(info.data) - Date.now();
    if (!(falta > 0)) {
      $('contagem-caixas').hidden = true;
      $('contagem-titulo').textContent = '🔴 É hoje! Acompanhe a live no Instagram @' + estado.data.config.instagram;
      return;
    }
    $('contagem-caixas').hidden = false;
    var s = Math.floor(falta / 1000);
    $('cd-d').textContent = String(Math.floor(s / 86400));
    $('cd-h').textContent = String(Math.floor((s % 86400) / 3600)).padStart(2, '0');
    $('cd-m').textContent = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    $('cd-s').textContent = String(s % 60).padStart(2, '0');
  }

  /* ---------- ranking ---------- */

  function renderRanking() {
    var lista = $('ranking-lista');
    var top = R.ranking(estado.data, 3);
    var medalhas = ['🥇', '🥈', '🥉'];
    lista.replaceChildren();
    if (!top.length) {
      lista.appendChild(R.el('li', { class: 'ranking-vazio', text: 'Ainda ninguém por aqui. Seja o primeiro! 💛' }));
      return;
    }
    top.forEach(function (item, i) {
      var btn = R.el('button', { type: 'button', class: 'ranking-ig', text: item.ig, title: 'Ver números de ' + item.ig });
      btn.addEventListener('click', function () { buscar(item.ig, true); });
      lista.appendChild(R.el('li', { class: 'ranking-item pos-' + (i + 1) }, [
        R.el('span', { class: 'ranking-medalha', text: medalhas[i], 'aria-hidden': 'true' }),
        btn,
        R.el('span', { class: 'ranking-qtd', text: item.qtd + (item.qtd === 1 ? ' número' : ' números') })
      ]));
    });
  }

  /* ---------- busca por @ ---------- */

  function renderHandles(agora) {
    var dl = $('lista-handles');
    var handles = R.handlesAtivos(estado.data, agora);
    var chave = handles.join(' ');
    if (dl.getAttribute('data-chave') === chave) return;
    dl.setAttribute('data-chave', chave);
    dl.replaceChildren();
    handles.forEach(function (h) {
      dl.appendChild(R.el('option', { value: h }));
    });
  }

  function buscar(valor, rolar) {
    var h = R.normalizarHandle(valor);
    estado.busca = h;
    $('busca').value = h;
    try {
      history.replaceState(null, '', h ? '#' + encodeURIComponent(h).replace('%40', '@') : location.pathname + location.search);
    } catch (e) { /* ignora */ }
    atualizar();
    renderBusca(rolar);
  }

  function renderBusca(rolar) {
    var box = $('busca-resultado');
    var h = estado.busca;
    $('btn-limpar-busca').hidden = !h;
    if (!h || !estado.data) { box.hidden = true; box.replaceChildren(); return; }

    var agora = Date.now();
    var c = estado.data.config;
    var lista = R.numerosDoHandle(estado.data, h, agora);
    box.replaceChildren();
    box.hidden = false;

    if (!lista.length) {
      box.appendChild(R.el('p', { class: 'busca-vazio' }, [
        'Nenhum número encontrado para ', R.el('strong', { text: h }),
        '. Se você já mandou o comprovante, aguarde alguns minutos até a confirmação.'
      ]));
      var parecidos = R.handlesAtivos(estado.data, agora).filter(function (x) {
        return x.indexOf(h.slice(1)) !== -1;
      }).slice(0, 5);
      if (parecidos.length) {
        var p = R.el('p', { class: 'busca-sugestoes' }, ['Você quis dizer: ']);
        parecidos.forEach(function (x) {
          var b = R.el('button', { type: 'button', class: 'link', text: x });
          b.addEventListener('click', function () { buscar(x, true); });
          p.appendChild(b);
          p.appendChild(document.createTextNode(' '));
        });
        box.appendChild(p);
      }
      return;
    }

    var pagos = lista.filter(function (x) { return x.status === 'pago'; }).length;
    var reservados = lista.length - pagos;
    var resumoTxt = lista.length + (lista.length === 1 ? ' número' : ' números') +
      ' · ' + R.formatarBRL(lista.length * c.precoNumero);
    if (reservados) resumoTxt += ' · ' + pagos + ' pago(s), ' + reservados + ' reservado(s)';

    var chips = R.el('ul', { class: 'chips' });
    lista.forEach(function (x) {
      var t = R.pad(x.n, c.totalNumeros);
      if (x.status === 'reservado') {
        var min = Math.max(1, Math.ceil(R.msRestantesReserva(x.entrada, c, agora) / 60000));
        t += ' (reservado · ' + min + ' min)';
      }
      chips.appendChild(R.el('li', { class: 'chip ' + x.status, text: t }));
    });

    var verGrade = R.el('button', { type: 'button', class: 'btn', text: 'Ver na grade' });
    verGrade.addEventListener('click', function () { rolarParaPrimeiro(lista[0].n); });

    box.appendChild(R.el('div', { class: 'busca-cabecalho' }, [
      R.el('div', null, [
        R.el('p', { class: 'busca-ig', text: h }),
        R.el('p', { class: 'busca-resumo', text: resumoTxt })
      ]),
      verGrade
    ]));
    box.appendChild(chips);
    if (rolar) {
      requestAnimationFrame(function () {
        setTimeout(function () { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50);
      });
    }
  }

  function rolarParaPrimeiro(n) {
    if (estado.filtro === 'disponiveis') definirFiltro('todos');
    var cel = estado.celulas[n - 1];
    if (cel) cel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function aplicarBuscaDaUrl() {
    var hash = '';
    try { hash = decodeURIComponent(location.hash.slice(1) || ''); } catch (e) { return; }
    if (hash.charAt(0) !== '@') return;
    buscar(hash, false);
    // espera o navegador terminar de carregar (ele mexe na rolagem no evento load)
    var rolar = function () {
      setTimeout(function () {
        $('busca-resultado').scrollIntoView({ behavior: 'instant', block: 'center' });
      }, 150);
    };
    if (document.readyState === 'complete') rolar();
    else window.addEventListener('load', rolar, { once: true });
  }

  /* ---------- seleção (apenas local, para montar a mensagem) ---------- */

  function renderSelecao() {
    var barra = $('barra-selecao');
    var c = estado.data.config;
    var nums = Array.from(estado.selecionados).sort(function (a, b) { return a - b; });
    document.body.classList.toggle('com-barra', nums.length > 0);
    barra.hidden = !nums.length;
    if (!nums.length) { fecharFinalizar(); return; }
    var lista = nums.map(function (n) { return R.pad(n, c.totalNumeros); }).join(', ');
    $('sel-qtd').textContent = nums.length + (nums.length === 1 ? ' número' : ' números');
    $('sel-total').textContent = R.formatarBRL(nums.length * c.precoNumero);
    $('sel-lista').textContent = lista;
    $('dlg-pedido').textContent = mensagemSelecao();
    $('dlg-total').textContent = R.formatarBRL(nums.length * c.precoNumero);
  }

  /* ---------- janela "Finalizar compra" ---------- */

  // Quem vem do link da bio abre o site no navegador interno do Instagram (ou do Facebook).
  // Lá dentro, links para instagram.com ficam carregando sem parar, então só orientamos a voltar ao app.
  var NAVEGADOR_INTERNO = /Instagram|FBAN|FBAV/i.test(navigator.userAgent || '');

  function abrirFinalizar() {
    var dlg = $('dlg-finalizar');
    $('dlg-instrucao-app').hidden = !NAVEGADOR_INTERNO;
    $('dlg-instrucao-web').hidden = NAVEGADOR_INTERNO;
    if (dlg.open) return;
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else { dlg.setAttribute('open', ''); dlg.classList.add('sem-modal'); }
    document.body.classList.add('dialogo-aberto');
  }

  function fecharFinalizar() {
    var dlg = $('dlg-finalizar');
    if (!dlg.open) return;
    if (typeof dlg.close === 'function') dlg.close();
    else { dlg.removeAttribute('open'); dlg.classList.remove('sem-modal'); dlg.dispatchEvent(new Event('close')); }
  }

  function mensagemSelecao() {
    var c = estado.data.config;
    var nums = Array.from(estado.selecionados).sort(function (a, b) { return a - b; });
    var lista = nums.map(function (n) { return R.pad(n, c.totalNumeros); }).join(', ');
    return 'Olá! Quero reservar ' + (nums.length === 1 ? 'o número ' : 'os números ') + lista +
      ' da rifa do ' + c.premio + '. Total: ' + R.formatarBRL(nums.length * c.precoNumero) +
      '. Já vou fazer o Pix e enviar o comprovante.';
  }

  /* ---------- resultado e hash ---------- */

  function renderResultado() {
    var c = estado.data.config;
    var sec = $('resultado');
    var r = c.resultado;
    var n = r && parseInt(r.numero, 10);
    if (c.status !== 'sorteada' || !(n >= 1 && n <= c.totalNumeros)) { sec.hidden = true; return; }
    sec.hidden = false;
    var e = estado.data.numeros[String(n)];
    $('resultado-numero').textContent = R.pad(n, c.totalNumeros);
    $('resultado-ig').textContent = e && e.status === 'pago' ? 'Ganhador: ' + e.ig + ' 🎉' : '';
    var video = $('resultado-video');
    var url = r.videoUrl;
    var ok = typeof url === 'string' && /^https:\/\/(www\.)?instagram\.com\//i.test(url);
    video.hidden = !ok;
    if (ok) video.href = url;
  }

  function renderHash() {
    var c = estado.data.config;
    var card = $('hash-card');
    var hashPublicado = typeof c.hashListaFinal === 'string' && /^[0-9a-f]{64}$/.test(c.hashListaFinal) ? c.hashListaFinal : null;
    if (!hashPublicado) { card.hidden = true; return; }
    card.hidden = false;
    var lista = R.listaCanonica(estado.data);
    $('hash-valor').textContent = hashPublicado;
    $('hash-lista').textContent = lista;
    if (estado.hashCalculadoPara === lista + hashPublicado) return;
    estado.hashCalculadoPara = lista + hashPublicado;
    R.sha256Hex(lista).then(function (h) {
      var p = $('hash-confere');
      if (!h) { p.textContent = ''; return; }
      p.textContent = h === hashPublicado
        ? '✅ A lista atual confere com o hash publicado.'
        : '⚠️ A lista atual NÃO confere com o hash publicado.';
      p.className = h === hashPublicado ? 'ok' : 'erro';
    });
  }

  /* ---------- utilidades de UI ---------- */

  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('visivel');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('visivel'); }, 3200);
  }

  function definirFiltro(f) {
    estado.filtro = f;
    document.querySelectorAll('.filtro').forEach(function (b) {
      b.classList.toggle('ativo', b.getAttribute('data-filtro') === f);
    });
    atualizar();
  }

  /* ---------- eventos ---------- */

  function ligarEventos() {
    $('grade').addEventListener('click', function (ev) {
      var btn = ev.target.closest('.num');
      if (!btn || !estado.data) return;
      var n = parseInt(btn.getAttribute('data-n'), 10);
      var c = estado.data.config;
      var e = estado.data.numeros[String(n)];
      var st = R.statusEfetivo(e, c, Date.now());
      var nn = R.pad(n, c.totalNumeros);
      if (st === 'pago') { toast('Número ' + nn + ' já é de ' + e.ig + ' ✅'); return; }
      if (st === 'reservado') {
        var min = Math.max(1, Math.ceil(R.msRestantesReserva(e, c, Date.now()) / 60000));
        toast('Número ' + nn + ' reservado por ' + e.ig + '. Se não for pago em ' + min + ' min, volta a ficar disponível.');
        return;
      }
      if (c.status !== 'aberta') { toast('As vendas estão encerradas.'); return; }
      if (estado.selecionados.has(n)) estado.selecionados.delete(n);
      else estado.selecionados.add(n);
      atualizar();
    });

    document.querySelectorAll('.filtro').forEach(function (b) {
      b.addEventListener('click', function () { definirFiltro(b.getAttribute('data-filtro')); });
    });

    $('form-busca').addEventListener('submit', function (ev) {
      ev.preventDefault();
      buscar($('busca').value, true);
    });
    var debounce;
    $('busca').addEventListener('input', function () {
      clearTimeout(debounce);
      var v = $('busca').value;
      debounce = setTimeout(function () {
        estado.busca = R.normalizarHandle(v);
        atualizar();
      }, 250);
    });
    $('btn-limpar-busca').addEventListener('click', function () { buscar('', false); $('busca').focus(); });

    $('btn-copiar-pix').addEventListener('click', function () {
      if (!estado.data) return;
      R.copiarTexto(estado.data.config.pixChave).then(function (ok) {
        toast(ok ? 'Chave Pix copiada! ✅' : 'Não deu para copiar. Chave: ' + estado.data.config.pixChave);
      });
    });

    $('btn-finalizar').addEventListener('click', function () {
      if (!estado.data || !estado.selecionados.size) return;
      abrirFinalizar();
    });
    $('dlg-fechar').addEventListener('click', fecharFinalizar);
    $('dlg-finalizar').addEventListener('close', function () {
      document.body.classList.remove('dialogo-aberto');
    });
    $('dlg-finalizar').addEventListener('click', function (ev) {
      if (ev.target === ev.currentTarget) fecharFinalizar(); // toque fora da janela
    });
    $('dlg-copiar-pedido').addEventListener('click', function () {
      if (!estado.data) return;
      R.copiarTexto(mensagemSelecao()).then(function (ok) {
        toast(ok ? 'Pedido copiado! ✅ Agora faça o Pix.' : 'Não deu para copiar. Segure o dedo no texto do pedido para copiar.');
      });
    });
    $('dlg-copiar-pix').addEventListener('click', function () {
      if (!estado.data) return;
      R.copiarTexto(estado.data.config.pixChave).then(function (ok) {
        toast(ok ? 'Chave Pix copiada! ✅' : 'Não deu para copiar. Chave: ' + estado.data.config.pixChave);
      });
    });

    $('btn-limpar-sel').addEventListener('click', function () {
      estado.selecionados.clear();
      atualizar();
    });

    var foto = $('foto');
    var usarReserva = function () {
      if (!/sem-foto\.svg$/.test(foto.src)) foto.src = 'img/sem-foto.svg';
    };
    foto.addEventListener('error', usarReserva);
    // o erro pode ter acontecido antes deste script rodar
    if (foto.complete && foto.naturalWidth === 0) usarReserva();

    window.addEventListener('hashchange', aplicarBuscaDaUrl);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) carregar(false);
    });
  }

  ligarEventos();
  carregar(true);
  setInterval(function () { carregar(false); }, 60000);   // busca novos dados
  setInterval(atualizar, 30000);                           // expira reservas na tela
  setInterval(tickContagem, 1000);                         // relógio
})();
