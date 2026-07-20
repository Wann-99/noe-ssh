export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const items = [
    ['Ctrl', 'Enter', '连接'],
    ['Ctrl', 'D', '断开'],
    ['Ctrl', 'L', '清屏'],
    ['Ctrl', 'F', '终端搜索'],
    ['Ctrl', '+ / -', '字体大小'],
    ['F11', '', '终端区域全屏'],
    ['Esc', '', '关闭弹窗'],
  ];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>快捷键</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>×</button>
        </div>
        <div className="shortcuts-list">
          {items.map(([a, b, desc]) => (
            <div key={desc}>
              <kbd>{a}</kbd>
              {b ? <> + <kbd>{b}</kbd></> : null}
              <span>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
