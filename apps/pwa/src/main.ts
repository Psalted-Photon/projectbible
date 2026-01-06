import { renderApp } from '@projectbible/core';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app element');

renderApp(root);
