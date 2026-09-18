const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desk', {
  onState(callback) {
    ipcRenderer.on('state', (_event, state) => callback(state));
  },
  setIgnore(ignore) {
    ipcRenderer.send('ignore-mouse', ignore);
  },
  menu(action, payload) {
    return ipcRenderer.invoke('menu', action, payload);
  },
  addDeadline(item) {
    return ipcRenderer.invoke('ddl-add', item);
  },
  toggleDeadline(id) {
    return ipcRenderer.invoke('ddl-toggle', id);
  },
  removeDeadline(id) {
    return ipcRenderer.invoke('ddl-remove', id);
  },
  seek(ratio) {
    return ipcRenderer.invoke('seek', ratio);
  },
  togglePlay() {
    return ipcRenderer.invoke('toggle-play');
  },
  skip(direction) {
    return ipcRenderer.invoke('skip', direction);
  },
});
