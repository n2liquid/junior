let jr = module.exports = exports = target => {
  if (typeof target === 'string') {
    return jr.find(target);
  }

  if (typeof target[Symbol.iterator] === 'function') {
    let ret = Array.from(target);

    ret.jr = new JrProp(ret);

    for (let el of ret) {
      el.jr = new JrProp(el);
    }

    return ret;
  }

  target.jr = new JrProp(target);

  return target;
};

class JrProp {
  constructor(ctx) {
    if (!Array.isArray(ctx) && ctx.jr) {
      Object.assign(this, ctx.jr);
    }

    this.ctx = ctx;
  }

  find(selector) {
    if (Array.isArray(this.ctx)) {
      let matches = new Set();

      for (let thisEl of this.ctx) {
        for (let thatEl of jr.find(selector, thisEl)) {
          matches.add(thatEl);
        }
      }

      return Array.from(matches);
    }
    else {
      return jr.find(selector, this.ctx);
    }
  }

  findFirst(selector) {
    if (Array.isArray(this.ctx)) {
      for (let thisEl of this.ctx) {
        let thatEl = jr.findFirst(selector, thisEl);

        if (thatEl) {
          return thatEl;
        }
      }

      return null;
    }
    else {
      return jr.findFirst(selector, this.ctx);
    }
  }

  get parentElements() {
    if (Array.isArray(this.ctx)) {
      throw new Error(
        `jr.parentElements only works with single elements`,
      );
    }

    let ret = [];
    let cursorEl = this.ctx;

    while (cursorEl.parentElement) {
      ret.push(cursorEl.parentElement);
      cursorEl = cursorEl.parentElement;
    }

    return ret;
  }

  getScope() {
    if (Array.isArray(this.ctx)) {
      throw new Error(
        `jr.getScope() only works with single elements`,
      );
    }

    return jr.getScope(this.ctx);
  }

  setScope(scope) {
    if (Array.isArray(this.ctx)) {
      throw new Error(
        `Cannot set scope for multiple elements at once`,
      );
    }

    return this.scope = scope;
  }
}

jr.find = (selector, el) => {
  let ret = Array.from(
    (el || document).querySelectorAll(selector),
  );

  ret.jr = new JrProp(ret);

  for (let foundEl of ret) {
    foundEl.jr = new JrProp(foundEl);
  }

  return ret;
};

jr.findFirst = (selector, el) => {
  let ret = (el || document).querySelector(selector);

  if (ret) {
    ret.jr = new JrProp(ret);
  }

  return ret;
};

Object.assign(jr, require('./helpers'));

jr.index = new Map();

jr.init = () => {
  jr.index = new Map();

  for (let el of jr.find('*')) {
    if (!document.contains(el)) {
      continue;
    }

    jr.initEl(el);
  }

  jr.observer = new MutationObserver(muts => {
    let dirtyAttrs = new Map();

    for (let mut of muts) {
      switch (mut.type) {
        case 'attributes': {
          if (
            !mut.attributeName.startsWith('jr-')
            || !document.contains(mut.target)
          ) {
            continue;
          }

          if (!dirtyAttrs.has(mut.target)) {
            dirtyAttrs.set(mut.target, []);
          }

          dirtyAttrs.get(mut.target).push(mut.attributeName);

          break;
        }

        case 'childList': {
          for (let n of mut.addedNodes) {
            if (
              n.nodeType !== Node.ELEMENT_NODE
              || jr.index.has(n)
            ) {
              continue;
            }

            let el = jr(n);

            jr.initEl(el);

            for (let descEl of el.jr.find('*')) {
              jr.initEl(descEl);
            }
          }

          removedNodesLoop:
          for (let n of mut.removedNodes) {
            if (
              n.nodeType !== Node.ELEMENT_NODE
              && n.nodeType !== Node.COMMENT_NODE
            ) {
              continue;
            }

            if (document.contains(n)) {
              continue;
            }

            let el = jr(n);

            for (let el2 of [el, ...el.jr.parentElements]) {
              let { commentAnchor } = el2.jr;

              if (
                commentAnchor
                && document.contains(commentAnchor)
              ) {
                continue removedNodesLoop;
              }
            }

            let { originalNode } = el.jr;

            if (
              originalNode
              && !document.contains(originalNode)
            ) {
              el = originalNode;
            }

            jr.index.delete(el);
          }

          break;
        }
      }
    }

    for (let [el, attrs] of dirtyAttrs.entries()) {
      jr.initEl(el);

      let indexEntry = jr.index.get(el);
      let indexAttrs = indexEntry.attrs;

      if (attrs.every(
        x => indexAttrs[x].value === el.getAttribute(x),
      )) {
        continue;
      }

      jr.updateEl(el);
    }
  });

  jr.observer.observe(document, {
    attributes: true,
    childList: true,
    subtree: true,
  });

  document.addEventListener('click', () => jr.update());
};

jr.initEl = el => {
  el = jr(el);

  if (jr.index.has(el) || el.nodeName === '#comment') {
    return;
  }

  let indexEntry;

  for (let i = 0; i < el.attributes.length; ++i) {
    let attr = el.attributes.item(i);

    if (!attr.name.startsWith('jr-')) {
      continue;
    }

    indexEntry = indexEntry || {
      el, attrs: {},
    };

    indexEntry.attrs[attr.name] = {
      name: attr.name,
      value: attr.value,
    };
  }

  if (!indexEntry) {
    return;
  }

  jr.index.set(el, indexEntry);
  jr.updateEl(el);

  if (el.tagName === 'INPUT') {
    el.addEventListener('keydown', jr.onChange);
    el.addEventListener('keyup', jr.onChange);
  }

  el.addEventListener('change', jr.onChange);
};

jr.getScope = el => {
  let scope = { refs: {}, els: [] };

  {
    let cursorEl = el;

    while (cursorEl) {
      if (cursorEl.jr && cursorEl.jr.listItem) {
        let { listItem } = cursorEl.jr;

        scope.refs[listItem.iteratorName] = {
          type: 'iterator',
          key: listItem.iteratorName,
          value: listItem.value,
        };
      }

      if (cursorEl.jr && cursorEl.jr.scope) {
        let cursorScope = cursorEl.jr.scope;

        scope.els.push(cursorEl);

        for (let [k, v] of Object.entries(cursorScope)) {
          if (scope.refs[k]) {
            continue;
          }

          scope.refs[k] = {
            type: 'scope',
            el: cursorEl,
            obj: cursorScope,
            key: k,
            value: v,
          };
        }
      }

      cursorEl = !cursorEl.jr || !cursorEl.jr.commentAnchor
        ? cursorEl.parentElement
        : cursorEl.jr.commentAnchor.parentElement;
    }
  }

  scope.hash = {};

  for (let [k, ref] of Object.entries(scope.refs)) {
    let { value } = ref;

    if (typeof ref.value === 'function') {
      value = value.bind(ref.obj);
    }

    scope.hash[k] = value;
  }

  scope.get = k => {
    let ref = scope.refs[k];
    return ref && ref.value;
  };

  let jsIdRe = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

  scope.getLocals = () => Object.keys(scope.hash)
    .filter(x => jsIdRe.test(x));

  scope.eval = expr => {
    try {
      let localsCode = scope.getLocals().join(', ');

      return new Function('$jrScopeHash', `
        const { ${localsCode} } = $jrScopeHash;
        return (${expr});
      `)(scope.hash);
    }
    catch (err) {
      if (err instanceof ReferenceError) {
        return null;
      }

      err.message = `${err.message} in ${expr}`;
      throw err;
    }
  };

  scope.set = (expr, v) => {
    try {
      let dotOperands = expr.split('.');

      let firstKey = dotOperands[0];
      let firstKeyRef = scope.refs[firstKey];

      if (!firstKeyRef) {
        throw new ReferenceError(
          `${firstKey} is undefined`,
        );
      }

      let restOfExpr = dotOperands.slice(1).join('.');

      if (restOfExpr) {
        restOfExpr = `.${restOfExpr}`;
      }

      let ctx;
      let genExpr = '$jrScopeCtx';

      switch (firstKeyRef.type) {
        case 'scope':
          ctx = firstKeyRef.obj;
          genExpr += `.${firstKey}${restOfExpr}`;

          break;

        case 'iterator':
          if (!restOfExpr) {
            throw new TypeError(
              `Assignment to constant variable (an ` +
              `iterator)`,
            );
          }

          ctx = firstKeyRef.value;
          genExpr += restOfExpr;

          break;

        default:
          throw new Error('???');
      }

      genExpr += ` = $jrScopeSetVal`;

      let localsCode = scope.getLocals().join(', ');

      return new Function(
        '$jrScopeHash', '$jrScopeCtx', '$jrScopeSetVal', `
          const { ${localsCode} } = $jrScopeHash;
          return (${genExpr});
        `,
      )(scope.hash, ctx, v);
    }
    catch (err) {
      let ErrorType = err.constructor;
      throw new ErrorType(`${err.message} in ${expr}`);
    }
  };

  return scope;
};

jr.onChange = ev => {
  let el = ev.target;

  try {
    let indexEntry = jr.index.get(el);

    if (!indexEntry) {
      return;
    }

    let attr = indexEntry.attrs['jr-value.bind'];

    if (!attr) {
      return;
    }

    let scope = jr.getScope(el);

    scope.set(attr.value, el.value);
  }
  catch (err) {
    err.message =
      `${err.message} while handling change` +
      ` event for ${jr.elAttrsToString(el)}`;

    throw err;
  }

  jr.update();
};

jr.updateIfEl = el => {
  el = jr(el);

  let scope = el.jr.getScope(el);

  let indexEntry = jr.index.get(el);
  let ifAttr = indexEntry.attrs['jr-if'];

  let condExpr = ifAttr.value = el.getAttribute('jr-if');

  let { evaluatedBefore } = ifAttr;
  let oldResult = ifAttr.computed;
  let result = !!scope.eval(condExpr);

  if (evaluatedBefore && result === oldResult) {
    return;
  }

  ifAttr.evaluatedBefore = true;
  ifAttr.computed = result;

  if (!evaluatedBefore && result) {
    return;
  }

  if (result) {
    indexEntry.commentAnchor.parentElement.replaceChild(
      el, indexEntry.commentAnchor,
    );

    el.jr.commentAnchor = null;
    indexEntry.commentAnchor = null;
  }
  else
  if (document.contains(el)) {
    let tagName = el.tagName.toLowerCase();

    let anchor = document.createComment(
      ` jr anchor for ${tagName}[jr-if="${condExpr}"] `,
    );

    anchor.jr = {
      originalNode: el,
    };

    el.parentElement.replaceChild(anchor, el);

    el.jr.commentAnchor = anchor;
    indexEntry.commentAnchor = anchor;
  }
};

jr.updateListEl = el => {
  let scope = jr.getScope(el);

  let indexEntry = jr.index.get(el);
  let listAttr = indexEntry.attrs['jr-list'];

  let listExpr =
    listAttr.value = el.getAttribute('jr-list');

  let parsedListExpr =
    /^[ \t\r\n]*for ([^ \t\r\n]+) of ([^ \t\r\n]+)[ \t\r\n]*$/
    .exec(listExpr);

  if (!parsedListExpr) {
    console.error(`[jr] Invalid jr-list expression in`, el);
    return;
  }

  let iteratorName = parsedListExpr[1];
  let iterableExpr = parsedListExpr[2];

  let oldList = listAttr.computed;

  let list = listAttr.computed =
    Array.from(scope.eval(iterableExpr));

  if (!oldList) {
    jr.initListEl({ el, listAttr, list, iteratorName });
    return;
  }

  let noDiff = true;

  if (list.length !== oldList.length) {
    noDiff = false;
  }
  else {
    for (let [i, v] of list.entries()) {
      if (oldList[i] === v) {
        continue;
      }

      noDiff = false;
      break;
    }
  }

  if (noDiff) {
    return;
  }

  let diff = jr.diffLists(oldList, list);

  let oldLis = Array.from(el.children);
  el.innerHTML = '';

  for (let x of diff) {
    switch (x.type) {
      case 'existing':
        el.appendChild(oldLis[x.from]);
        break;

      case 'new': {
        let newLi = jr(el.jr.refListItem.cloneNode(true));

        newLi.jr.listItem = {
          iteratorName,
          value: x.value,
        };

        el.appendChild(newLi);

        break;
      }

      default:
        throw new Error('???');
        break;
    }
  }
};

// TODO: Review computational complexity if too slow
// on realistic benchmarks.
jr.diffLists = (a, b) => {
  let diffs = {
    moved: [],
    added: [],
  };

  for (let [i, x] of a.entries()) {
    if (b[i] === x) {
      continue;
    }

    let newIndex = b.findIndex((y, j) => {
      if (y !== x) {
        return false;
      }

      return !diffs.moved.some(
        z => z.value === y && z.to !== j,
      );
    });

    if (newIndex === -1) {
      continue;
    }

    diffs.moved.push({
      value: x,
      from: i,
      to: newIndex,
    });
  }

  for (let [i, x] of b.entries()) {
    if (a[i] === x) {
      continue;
    }

    if (diffs.moved.some(y => y.value == x && y.to === i)) {
      continue;
    }

    diffs.added.push({
      value: x,
      to: i,
    });
  }

  return b.map((x, i) => {
    if (a[i] === x) {
      return { type: 'existing', from: i };
    }

    let moved = diffs.moved.find(y => y.to === i);

    return moved
      ? { type: 'existing', from: moved.from }
      : { type: 'new', value: x };
  });
};

jr.initListEl = ({ el, listAttr, list, iteratorName }) => {
  let refLi = el.jr.refListItem = el.firstElementChild;
  el.innerHTML = '';

  for (let x of list) {
    let li = jr(refLi.cloneNode(true));

    li.jr.listItem = {
      iteratorName,
      value: x,
    };

    el.appendChild(li);

    for (let el of [li, ...jr.find('*', li)]) {
      if (!document.contains(el)) {
        continue;
      }

      try {
        jr.initEl(el);
      }
      catch (err) {
        console.error(err);
      }
    }
  }
};

jr.updateEventAttr = (el, attrName) => {
  let indexEntry = jr.index.get(el);
  let attr = indexEntry.attrs[attrName];

  let evName = attrName.slice('jr-on-'.length);

  if (attr.handler) {
    el.removeEventListener(evName, attr.handler);
  }

  let scope = jr.getScope(el);
  let localsCode = scope.getLocals().join(', ');
  let handlerCode = attr.value = el.getAttribute(attrName);

  // FIXME: This is awfully broken, but will do for now.
  if (handlerCode.trim().includes('=')) {
    let [lhs, rhs] = handlerCode.split('=').map(x => x.trim());

    handlerCode =
      `$jrScope.set(${JSON.stringify(lhs)}, ${rhs})`;
  }

  attr.handler = new Function(
    '$jr', '$jrScope', '$jrEv', `
      const { ${localsCode} } = $jrScope.hash;
      const jr = Object.create($jr);

      jr.ev = $jrEv;

      ${handlerCode};
    `,
  ).bind(null, jr, scope);

  el.addEventListener(evName, attr.handler);
};

jr.updateEl = el => {
  try {
    let scope = jr.getScope(el);
    let indexEntry = jr.index.get(el);

    for (let attr of Object.values(indexEntry.attrs)) {
      if (attr.name === 'jr-if') {
        jr.updateIfEl(el);
        continue;
      }

      if (!document.contains(el)) {
        continue;
      }

      if (attr.name === 'jr-ref') {
        scope.set(el.getAttribute('jr-ref'), el);
        continue;
      }

      if (attr.name === 'jr-list') {
        jr.updateListEl(el);
        continue;
      }

      if (attr.name.startsWith('jr-on-')) {
        jr.updateEventAttr(el, attr.name);
        continue;
      }

      let computed = attr.value =
        el.getAttribute(attr.name);

      let interpRe = /{{([^}]+)}}/g;
      let interpList = [];

      while (true) {
        let reRes = interpRe.exec(computed);

        if (!reRes) {
          break;
        }

        interpList.push(reRes[1]);
      }

      for (let expr of interpList) {
        let value = scope.eval(expr);

        computed = computed.replace(
          new RegExp(jr.escapeRegExp(`{{${expr}}}`), 'g'),
          value,
        );
      }

      let isBind = attr.name.endsWith('.bind');
      let isToggle = attr.name.endsWith('.toggle');

      if (isBind || isToggle) {
        computed = scope.eval(computed);
      }

      if (computed === attr.computed) {
        continue;
      }

      attr.computed = computed;

      let targetName = attr.name
        .slice('jr-'.length)
        .replace(/\.(bind|toggle)$/, '');

      if (targetName === 'text-content') {
        if (isToggle) {
          throw new Error(
            `jr-text-content.toggle is not supported`,
          );
        }

        el.textContent = computed;
      }
      else
      if (isToggle) {
        if (computed) {
          el.setAttribute(targetName, '');
        }
        else {
          el.removeAttribute(targetName);
        }
      }
      else {
        let propTargets = ['value'];

        if (!propTargets.includes(targetName)) {
          el.setAttribute(targetName, computed);
        }
        else {
          el[targetName] = computed;
        }
      }
    }
  }
  catch (err) {
    err.message =
      `${err.message} while updating ${jr.elAttrsToString(el)}`;

    throw err;
  }
};

jr.update = () => {
  for (let el of jr.index.keys()) {
    try {
      jr.updateEl(el);
    }
    catch (err) {
      console.error(err);
    }
  }
};
