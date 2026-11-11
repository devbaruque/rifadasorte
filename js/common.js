/* Funções compartilhadas entre a página pública e o painel admin. */
(function (global) {
  'use strict';

  var HANDLE_RE = /^@[a-z0-9._]{1,30}$/;
  var REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  var FUSO = 'America/Sao_Paulo';

  var CONFIG_PADRAO = {
    titulo: 'Rifa Solidária',
    premio: '',
    foto: 'img/whisky.jpg',
    descricaoPremio: '',
    historia: '',
    precoNumero: 1,
    totalNumeros: 500,
    pixChave: '',
    pixNomeRecebedor: '',
    instagram: '',
    reservaMinutos: 10,
    dataLimite: null,
    dataMaximaAdiamento: null,
    adiado: false,
    dataSorteioAntecipado: null,
    status: 'aberta',
    hashListaFinal: null,
    resultado: null,
    repositorio: ''
  };

  /** "@Fulano", "fulano", "instagram.com/fulano/" → "@fulano" (minúsculo). */
  function normalizarHandle(valor) {
    if (typeof valor !== 'string') return '';
    var s = valor.trim()
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
      .replace(/[/?#].*$/, '')
      .replace(/^@+/, '')
      .toLowerCase();
    return s ? '@' + s : '';
  }

  function handleValido(h) {
    return typeof h === 'string' && HANDLE_RE.test(h);
  }

  function repoValido(r) {
    return typeof r === 'string' && REPO_RE.test(r);
  }

  function pad(n, total) {
    return String(n).padStart(String(total || 500).length, '0');
  }

  function clonar(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /** Garante estrutura e descarta qualquer dado fora do formato esperado. */
  function sanitizar(bruto) {
    var data = bruto && typeof bruto === 'object' ? bruto : {};
    var config = Object.assign({}, CONFIG_PADRAO, data.config || {});
    var total = parseInt(config.totalNumeros, 10);
    config.totalNumeros = total > 0 && total <= 100000 ? total : 500;
    var preco = Number(config.precoNumero);
    config.precoNumero = preco > 0 ? preco : 1;
    var minutos = Number(config.reservaMinutos);
    config.reservaMinutos = minutos > 0 ? minutos : 10;

    var numeros = {};
    var fonte = data.numeros && typeof data.numeros === 'object' ? data.numeros : {};
    Object.keys(fonte).forEach(function (k) {
      var n = parseInt(k, 10);
      var e = fonte[k];
      if (String(n) !== k || n < 1 || n > config.totalNumeros || !e) return;
      if (!handleValido(e.ig)) return;
      if (e.status !== 'pago' && e.status !== 'reservado') return;
      numeros[k] = { ig: e.ig, status: e.status, em: String(e.em || '') };
    });
    return { config: config, numeros: numeros };
  }

  /** 'disponivel' | 'reservado' | 'pago' — reservas vencidas contam como disponíveis. */
  function statusEfetivo(entrada, config, agora) {
    if (!entrada) return 'disponivel';
    if (entrada.status === 'pago') return 'pago';
    if (entrada.status === 'reservado') {
      return msRestantesReserva(entrada, config, agora) > 0 ? 'reservado' : 'disponivel';
    }
    return 'disponivel';
  }

  function msRestantesReserva(entrada, config, agora) {
    var t = Date.parse(entrada && entrada.em);
    if (!isFinite(t)) return 0;
    return t + config.reservaMinutos * 60000 - agora;
  }

  function resumo(data, agora) {
    var total = data.config.totalNumeros;
    var pagos = 0, reservados = 0;
    for (var n = 1; n <= total; n++) {
      var st = statusEfetivo(data.numeros[String(n)], data.config, agora);
      if (st === 'pago') pagos++;
      else if (st === 'reservado') reservados++;
    }
    return {
      total: total,
      pagos: pagos,
      reservados: reservados,
      disponiveis: total - pagos - reservados,
      esgotado: pagos === total
    };
  }

  /** Lista de números (pagos ou reservados válidos) de um @. */
  function numerosDoHandle(data, handle, agora) {
    var lista = [];
    if (!handle) return lista;
    Object.keys(data.numeros).forEach(function (k) {
      var e = data.numeros[k];
      if (e.ig !== handle) return;
      var st = statusEfetivo(e, data.config, agora);
      if (st === 'disponivel') return;
      lista.push({ n: parseInt(k, 10), status: st, entrada: e });
    });
    return lista.sort(function (a, b) { return a.n - b.n; });
  }

  /** Todos os @ com pelo menos um número pago ou reservado válido. */
  function handlesAtivos(data, agora) {
    var set = {};
    Object.keys(data.numeros).forEach(function (k) {
      var e = data.numeros[k];
      if (statusEfetivo(e, data.config, agora) !== 'disponivel') set[e.ig] = true;
    });
    return Object.keys(set).sort();
  }

  /** Ranking por números pagos; empate → quem comprou primeiro. */
  function ranking(data, limite) {
    var mapa = {};
    Object.keys(data.numeros).forEach(function (k) {
      var e = data.numeros[k];
      if (e.status !== 'pago') return;
      var t = Date.parse(e.em);
      if (!isFinite(t)) t = Infinity;
      var item = mapa[e.ig] || (mapa[e.ig] = { ig: e.ig, qtd: 0, primeiro: Infinity });
      item.qtd++;
      if (t < item.primeiro) item.primeiro = t;
    });
    return Object.keys(mapa).map(function (k) { return mapa[k]; })
      .sort(function (a, b) { return b.qtd - a.qtd || a.primeiro - b.primeiro || (a.ig < b.ig ? -1 : 1); })
      .slice(0, limite || 3);
  }

  /** Texto canônico da lista de pagos — é dele que sai o hash SHA-256. */
  function listaCanonica(data) {
    var total = data.config.totalNumeros;
    return Object.keys(data.numeros)
      .filter(function (k) { return data.numeros[k].status === 'pago'; })
      .map(function (k) { return parseInt(k, 10); })
      .sort(function (a, b) { return a - b; })
      .map(function (n) { return pad(n, total) + ' ' + data.numeros[String(n)].ig; })
      .join('\n');
  }

  function sha256Hex(texto) {
    if (!global.crypto || !global.crypto.subtle) return Promise.resolve(null);
    var bytes = new TextEncoder().encode(texto);
    return global.crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  /** Qual data vale para o sorteio agora. */
  function infoSorteio(config) {
    if (config.status === 'sorteada') return { fase: 'sorteada', data: null };
    if (config.dataSorteioAntecipado) return { fase: 'antecipado', data: config.dataSorteioAntecipado };
    if (config.adiado) return { fase: 'adiado', data: config.dataMaximaAdiamento };
    return { fase: 'normal', data: config.dataLimite };
  }

  var fmtCompleto = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  var fmtCurto = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });

  function formatarData(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return '';
    return fmtCompleto.format(new Date(t)).replace(', ', ' às ');
  }

  function formatarDataCurta(iso) {
    var t = Date.parse(iso);
    return isFinite(t) ? fmtCurto.format(new Date(t)) : '';
  }

  var fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  function formatarBRL(v) { return fmtBRL.format(v); }

  /** Criação de elementos sempre via textContent (nunca innerHTML). */
  function el(tag, attrs, filhos) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    (filhos || []).forEach(function (f) {
      if (f == null) return;
      node.appendChild(typeof f === 'string' ? document.createTextNode(f) : f);
    });
    return node;
  }

  /** Quebra um texto em parágrafos (<p>) dentro do container. */
  function preencherParagrafos(container, texto) {
    container.replaceChildren();
    String(texto || '').split(/\n\s*\n/).forEach(function (par) {
      if (par.trim()) container.appendChild(el('p', { text: par.trim() }));
    });
  }

  function copiarTexto(texto) {
    function alternativo() {
      var ta = document.createElement('textarea');
      ta.value = texto;
      ta.setAttribute('readonly', '');
      ta.className = 'copia-oculta';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    }
    if (navigator.clipboard && global.isSecureContext) {
      return navigator.clipboard.writeText(texto).then(function () { return true; }, alternativo);
    }
    return Promise.resolve(alternativo());
  }

  global.Rifa = {
    normalizarHandle: normalizarHandle,
    handleValido: handleValido,
    repoValido: repoValido,
    pad: pad,
    clonar: clonar,
    sanitizar: sanitizar,
    statusEfetivo: statusEfetivo,
    msRestantesReserva: msRestantesReserva,
    resumo: resumo,
    numerosDoHandle: numerosDoHandle,
    handlesAtivos: handlesAtivos,
    ranking: ranking,
    listaCanonica: listaCanonica,
    sha256Hex: sha256Hex,
    infoSorteio: infoSorteio,
    formatarData: formatarData,
    formatarDataCurta: formatarDataCurta,
    formatarBRL: formatarBRL,
    el: el,
    preencherParagrafos: preencherParagrafos,
    copiarTexto: copiarTexto
  };
})(window);
