/**
 * 动作注册表 —— 全项目动作元数据的**唯一来源**。
 *
 * 背景：此前同一批动作 ID 散落在 6 个互不相干的表里
 * （action_handlers 的 ACTION_IDS、main 的 DANGEROUS_ACTIONS、
 *  renderer 的 FEATURE_DANGER / DANGEROUS_ACTIONS / INSTALL_ACTIONS /
 *  FASTBOOT_REQUIRED_ACTIONS / ADB_REQUIRED_ACTIONS），
 * 任何一处改动都可能造成主进程与界面判定不一致。
 * 本文件把这些集合集中定义，两侧一律从这里派生。
 *
 * 该文件同时被 Node（main 进程 require）和浏览器（renderer 通过 <script> 引入）使用，
 * 因此写成 UMD 形式，且不得依赖任何 Node 内置模块。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ACTIONS_REGISTRY = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 会被写入设备、应用状态或系统分区的动作，执行前必须二次确认。 */
  const DANGEROUS_ACTIONS = [
    'firmware-flash', 'flash-image', 'fastboot-set-active', 'lenovo-unlock-go', 'moto-bl-unlock', 'reboot-fastbootd',
    'gms-uninstall', 'gms-fix-crash', 'gms-persistent-fix', 'uninstall-package', 'uninstall-packages-batch',
    'clear-app-data', 'freeze-app-user0', 'freeze-apps-user0-batch', 'clear-storage-cache', 'clear-storage-junk',
    'clear-storage-photos', 'clear-storage-videos', 'bootanim-install-zip', 'bootanim-install-checked',
    'bootanim-install-latest-portable', 'bootanim-restore', 'reset-display', 'configure-denylist-user-apps',
    'install-framework'
  ];

  /** 会产生安装进度的动作，界面据此显示进度弹窗。 */
  const INSTALL_ACTIONS = [
    'install-apk', 'install-apk-single', 'install-apk-batch', 'install-framework',
    'install-clone-tools', 'install-users-manager', 'install-aiwanji-toolbox',
    'install-magisk', 'gms-install-builtin', 'gms-import-local'
  ];

  /** 需要设备处于 Fastboot 模式才能执行。 */
  const FASTBOOT_REQUIRED_ACTIONS = [
    'firmware-flash', 'flash-image', 'boot-image', 'fastboot-set-active', 'fastboot-continue',
    'fastboot-getvar-all', 'fastboot-unlock-status', 'lenovo-unlock-go', 'moto-bl-unlock', 'reboot-fastbootd'
  ];

  /** 需要设备处于 ADB 系统模式才能执行。 */
  const ADB_REQUIRED_ACTIONS = [
    'uninstall-package', 'clear-app-data', 'freeze-app-user0', 'unfreeze-app-user0', 'gms-uninstall',
    'export-apks-batch', 'uninstall-packages-batch', 'freeze-apps-user0-batch', 'unfreeze-apps-user0-batch',
    'storage-summary', 'list-storage-files', 'export-storage-files', 'clear-storage-cache', 'clear-storage-junk',
    'clear-storage-photos', 'clear-storage-videos',
    'gms-fix-crash', 'gms-persistent-fix', 'configure-denylist-user-apps', 'gms-install-builtin', 'gms-import-local'
  ];

  /** 危险动作的专属确认文案；未列出的危险动作使用通用文案。 */
  const ACTION_CONFIRMS = {
    'configure-denylist-user-apps': '将当前用户全部已安装应用加入 Magisk DenyList，确认继续？',
    'uninstall-package': '卸载主用户应用可能导致数据不可用，确认继续？',
    'clear-app-data': '清理应用数据不可撤销，确认账号和本地数据可以恢复后继续？',
    'freeze-app-user0': '冻结应用会使它无法启动和接收消息，确认继续？',
    'gms-fix-crash': '此操作会清理主用户的 GSF、Play 服务和 Play 商店数据，Google 账号可能需要重新登录，确认继续？',
    'gms-persistent-fix': '此操作会修改 Google 组件后台策略，并在有 Root 时写入 Magisk service.d，确认继续？',
    'bootanim-install-latest-portable': '安装开机动画会写入系统分区，程序会先备份，确认继续？'
  };

  return {
    DANGEROUS_ACTIONS,
    INSTALL_ACTIONS,
    FASTBOOT_REQUIRED_ACTIONS,
    ADB_REQUIRED_ACTIONS,
    ACTION_CONFIRMS
  };
});
