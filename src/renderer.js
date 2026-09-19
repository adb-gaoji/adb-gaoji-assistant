const pages = {
  device: ['设备概览', '查看连接状态、设备信息和常用重启操作'],
  system: ['连接与投屏', '检测连接、修复 ADB 并启动有线或无线投屏'],
  root: ['Root 与面具', '检测 Root、Magisk 并安装 APK'],
  extract: ['分区提取', '备份 boot 与 init_boot 分区镜像'],
  firmware: ['固件刷机', '选择官方刷机包并执行整机 Fastboot 固件流程'],
  fastboot: ['引导刷入', '临时启动或谨慎刷入设备镜像'],
  tools: ['基础工具', '文件、显示、驱动与终端常用工具'],
  apps: ['应用管理', '安装、导出、卸载、清理和冻结应用'],
  gms: ['谷歌三件套', '检测、安装和修复 Google 服务框架、Play 服务与 Play 商店'],
  repair: ['修复与救砖', '无线、基带、救砖、分身和刷机后复测工具'],
  advanced: ['高级工具目录', '原版工作台的完整功能入口，按维护流程分组'],
  log: ['运行日志', '查看 ADB 与 Fastboot 的实时命令输出']
};

const FEATURE_GROUPS = {
  diagnose: [
    'adb-diagnose', 'ai-copilot-scan', 'ai-smart-troubleshoot', 'ai-full-diagnose', 'ai-super-plan',
    'ai-export-report', 'save-device-snapshot', 'compare-device-snapshot', 'device-report',
    'strategy-check', 'refresh-profile', 'task-queue-open', 'command-history', 'export-log',
    'export-architecture-plan', 'flash-compatibility-gate', 'resume-flash'
  ],
  rootflash: [
    'check-zygisk', 'configure-denylist-user-apps', 'list-magisk-modules', 'fastboot-continue', 'fastboot-getvar-all', 'fastboot-unlock-status',
    'fastboot-set-active', 'lenovo-unlock-go', 'moto-bl-unlock', 'reboot-fastbootd',
    'backup-key-partitions', 'extract-payload-bin', 'preview-flash', 'show-flash'
  ],
  repair: [
    'fix-adb-port', 'wireless-adb', 'fix-wifi-after-flash', 'fix-bluetooth-soft', 'fix-voice-call-audio',
    'diagnose-baseband', 'diagnose-wireless-stack', 'edl-9008-console', 'tea-clone-runtime-fix',
    'open-qpst-tools', 'install-lenovo-9008-driver', 'install-lenovo-deep-test', 'rescue-diagnose'
  ],
  apps: [
    'install-apk', 'install-apk-single', 'install-apk-batch', 'install-framework', 'install-clone-tools',
    'install-users-manager', 'install-aiwanji-toolbox', 'list-packages', 'export-apk', 'uninstall-package',
    'clear-app-data', 'freeze-app-user0', 'unfreeze-app-user0', 'gms-install-builtin', 'gms-fix-crash',
    'gms-persistent-fix', 'gms-deep-diagnose', 'gms-fix-app-license', 'gms-download-adapted',
    'gms-import-local', 'gms-open-downloads', 'gms-open-google-switch', 'gms-uninstall', 'fix-tiktok-network'
  ],
  tools: [
    'adb-authorize', 'adb-reboot-system', 'reboot-system', 'reboot-recovery', 'reboot-fastboot',
    'fastboot-reboot', 'push-file', 'pull-path', 'screenshot', 'screenrecord', 'change-dpi',
    'change-size', 'reset-display', 'start-freecontrol', 'start-mirror', 'start-mirror-hq',
    'start-mirror-viewonly', 'mirror-console', 'wireless-mirror', 'install-driver',
    'install-bundled-adb-driver', 'open-terminal', 'open-tools-output', 'open-lan-share', 'clone-downloads', 'open-matched-firmware',
    'open-output', 'open-key-backup-dir'
  ],
  bootanim: [
    'bootanim-backup', 'bootanim-extract-portable', 'bootanim-check-latest-portable',
    'bootanim-install-latest-portable', 'bootanim-compat-check', 'bootanim-install-checked',
    'bootanim-install-zip', 'bootanim-image', 'bootanim-video', 'bootanim-restore', 'bootlogo-diagnose'
  ]
};

const FEATURE_LABELS = {
  'adb-diagnose': 'ADB 诊断', 'ai-copilot-scan': '智能连接扫描', 'ai-smart-troubleshoot': '规则化智能排障',
  'ai-full-diagnose': '全机智能诊断', 'ai-super-plan': '生成维修方案', 'ai-export-report': '导出诊断报告',
  'save-device-snapshot': '保存设备快照', 'compare-device-snapshot': '比较设备快照', 'device-report': '设备信息报告',
  'strategy-check': '维修策略检查', 'refresh-profile': '刷新设备档案', 'task-queue-open': '任务队列',
  'command-history': '命令历史', 'export-log': '导出日志', 'export-architecture-plan': '导出架构方案',
  'flash-compatibility-gate': '刷机兼容性门禁', 'resume-flash': '返回刷机工作台',
  'check-root': '检测 Root', 'check-magisk': '检测 Magisk', 'check-zygisk': '检测 Zygisk', 'configure-denylist-user-apps': '批量加入 DenyList',
  'list-magisk-modules': 'Magisk 模块', 'install-magisk': '安装 Alpha 面具', 'extract-all': '一键提取分区',
  'fastboot-continue': 'Fastboot 继续启动', 'fastboot-getvar-all': '读取 Fastboot 变量',
  'fastboot-unlock-status': '检测解锁状态', 'fastboot-set-active': '切换活动槽位', 'lenovo-unlock-go': '联想一键解锁',
  'moto-bl-unlock': '摩托解锁向导', 'reboot-fastbootd': '重启到 FastbootD', 'boot-image': '临时启动镜像',
  'flash-image': '刷入镜像', 'backup-key-partitions': '备份关键分区', 'extract-payload-bin': '提取 payload.bin',
  'preview-flash': '预览刷机流程', 'show-flash': '打开刷机工作台',
  'fix-adb-port': '修复 ADB 端口', 'wireless-adb': '无线 ADB', 'fix-wifi-after-flash': '刷机后修复 Wi-Fi',
  'fix-bluetooth-soft': '修复蓝牙', 'fix-voice-call-audio': '修复通话音频', 'diagnose-baseband': '基带诊断',
  'diagnose-wireless-stack': '无线栈诊断', 'edl-9008-console': '9008 救砖控制台', 'tea-clone-runtime-fix': 'Tea 分身运行修复',
  'open-qpst-tools': '打开 QPST 工具', 'install-lenovo-9008-driver': '安装联想 9008 驱动',
  'install-lenovo-deep-test': '安装联想深度测试', 'rescue-diagnose': '救砖路径分析',
  'install-apk': '安装 APK', 'install-apk-single': '单个安装 APK', 'install-apk-batch': '批量安装 APK',
  'install-framework': '安装框架组件', 'install-clone-tools': '安装分身工具', 'install-users-manager': '安装用户管理器',
  'install-aiwanji-toolbox': '安装爱玩机工具箱', 'list-packages': '列出已安装应用', 'export-apk': '导出 APK',
  'uninstall-package': '卸载应用', 'clear-app-data': '清理应用数据', 'freeze-app-user0': '冻结主用户应用',
  'unfreeze-app-user0': '解冻主用户应用', 'storage-summary': '扫描存储空间', 'clear-storage-cache': '清理应用缓存',
  'export-apks-batch': '批量导出 APK', 'uninstall-packages-batch': '批量卸载应用',
  'freeze-apps-user0-batch': '批量冻结应用', 'unfreeze-apps-user0-batch': '批量解冻应用',
  'clear-storage-junk': '清理垃圾文件', 'clear-storage-photos': '清理照片', 'clear-storage-videos': '清理视频',
  'list-storage-files': '浏览手机文件',
  'export-storage-files': '导出手机文件',
  'gms-install-builtin': '安装谷歌三件套', 'gms-fix-crash': '修复 GMS 闪退',
  'gms-persistent-fix': '修复 GMS 重启失效', 'gms-deep-diagnose': 'GMS 深度诊断', 'gms-fix-app-license': '修复应用授权',
  'gms-download-adapted': '准备内置 GMS 包', 'gms-import-local': '导入本地 GMS', 'gms-open-downloads': '打开 GMS 下载目录',
  'gms-open-google-switch': '打开 Google 服务开关', 'gms-uninstall': '卸载谷歌三件套', 'fix-tiktok-network': '修复 TikTok 网络',
  'adb-authorize': '等待 ADB 授权', 'adb-reboot-system': 'ADB 重启系统', 'reboot-system': '重启系统',
  'reboot-recovery': '重启 Recovery', 'reboot-fastboot': '重启 Bootloader', 'fastboot-reboot': 'Fastboot 重启',
  'push-file': '推送文件', 'pull-path': '拉取文件', 'screenshot': '手机截图', 'screenrecord': '手机录屏',
  'change-dpi': '修改 DPI', 'change-size': '修改分辨率', 'reset-display': '恢复显示设置',
  'start-freecontrol': 'FreeControl 投屏', 'start-mirror': '开始有线投屏', 'start-mirror-hq': '高画质投屏',
  'start-mirror-viewonly': '仅显示不控制', 'mirror-console': '投屏控制台', 'mirror-session-status': '投屏状态', 'stop-mirror': '停止投屏', 'wireless-mirror': '无线投屏',
  'install-driver': '安装安卓驱动', 'install-bundled-adb-driver': '安装内置 ADB 驱动', 'open-terminal': '打开命令行',
  'open-tools-output': '打开工具输出目录', 'open-lan-share': '打开局域网共享', 'clone-downloads': '打开分身下载', 'open-matched-firmware': '打开匹配固件',
  'open-output': '打开输出目录', 'open-key-backup-dir': '打开关键分区备份目录',
  'bootanim-backup': '备份开机动画', 'bootanim-extract-portable': '提取当前开机动画',
  'bootanim-check-latest-portable': '检查最新本地动画', 'bootanim-install-latest-portable': '安装最新本地动画',
  'bootanim-compat-check': '检查动画包兼容性', 'bootanim-install-checked': '安装已检查动画包',
  'bootanim-install-zip': '安装 bootanimation.zip', 'bootanim-image': '制作图片开机动画',
  'bootanim-video': '制作视频开机动画', 'bootanim-restore': '恢复开机动画', 'bootlogo-diagnose': '开机 Logo 诊断'
};

const FEATURE_DESCRIPTIONS = {
  diagnose: '读取设备状态、生成报告并管理可恢复的任务流程。',
  rootflash: '涉及镜像和引导分区的操作会先选择文件并二次确认。',
  repair: '根据设备模式执行诊断或打开对应的修复工具。',
  apps: '应用操作默认针对主用户 0，安装和卸载会明确提示目标。',
  tools: '连接、投屏、文件和显示工具。',
  bootanim: '开机动画和备份工具，操作结果会写入运行日志。'
};

// 动作元数据来自 src/actions.registry.js（由 renderer.html 先行引入），
// 与主进程共用同一份定义，避免两侧判定漂移。
const ACTIONS_REGISTRY = window.ACTIONS_REGISTRY || {};

const FEATURE_DANGER = new Set(ACTIONS_REGISTRY.DANGEROUS_ACTIONS || []);

const DANGEROUS_ACTIONS = new Set(ACTIONS_REGISTRY.DANGEROUS_ACTIONS || []);

const INSTALL_ACTIONS = new Set(ACTIONS_REGISTRY.INSTALL_ACTIONS || []);

const ACTION_CONFIRMS = ACTIONS_REGISTRY.ACTION_CONFIRMS || {};

const FASTBOOT_REQUIRED_ACTIONS = new Set(ACTIONS_REGISTRY.FASTBOOT_REQUIRED_ACTIONS || []);
const ADB_REQUIRED_ACTIONS = new Set(ACTIONS_REGISTRY.ADB_REQUIRED_ACTIONS || []);

const ACTION_FORMS = {
  'pull-path': { title: '拉取手机文件', description: '输入手机中的完整路径，文件会保存到桌面工具输出目录。', fields: [{ name: 'remotePath', label: '手机路径', value: '/sdcard/Download/', hint: '例如 /sdcard/Download/report.zip' }] },
  'change-dpi': { title: '修改显示 DPI', description: '数值过大或过小会影响显示，可使用“恢复显示”回滚。', fields: [{ name: 'dpi', label: 'DPI', value: '420', pattern: '[0-9]{2,4}', hint: '建议范围 240 - 640' }] },
  'change-size': { title: '修改屏幕分辨率', description: '使用 Android wm size 设置覆盖分辨率。', fields: [{ name: 'size', label: '分辨率', value: '1080x2400', pattern: '[0-9]{3,4}x[0-9]{3,4}', hint: '格式：宽x高，例如 1080x2400' }] },
  'screenrecord': { title: '手机录屏', description: '录屏完成后自动拉取到桌面工具输出目录。', fields: [{ name: 'duration', label: '录制秒数', value: '15', pattern: '[0-9]{1,3}', hint: '建议 5 - 180 秒' }] },
  'wireless-adb': { title: '无线 ADB', description: '手机和电脑需处于同一局域网，先保持 USB 连接完成切换。', fields: [{ name: 'host', label: '手机 IP', value: '', pattern: '[0-9.]+', hint: '例如 192.168.1.88' }, { name: 'port', label: '端口', value: '5555', pattern: '[0-9]{2,5}' }] },
  'wireless-mirror': { title: '无线投屏', description: '手机和电脑需处于同一局域网，先保持 USB 连接完成无线 ADB 切换。', fields: [{ name: 'host', label: '手机 IP', value: '', pattern: '[0-9.]+', hint: '例如 192.168.1.88' }, { name: 'port', label: '端口', value: '5555', pattern: '[0-9]{2,5}' }] },
  'wireless-pair': { title: '无线调试配对', description: '适用于 Android 11 及以上。请在开发者选项的无线调试页面读取配对端口和 6 位配对码。', fields: [{ name: 'host', label: '手机 IP', value: '', pattern: '[0-9.]+', hint: '例如 192.168.1.88' }, { name: 'pairPort', label: '配对端口', value: '', pattern: '[0-9]{1,5}', hint: '配对弹窗中显示的端口' }, { name: 'pairingCode', label: '6 位配对码', value: '', pattern: '[0-9]{6}' }, { name: 'connectPort', label: '连接端口', value: '5555', pattern: '[0-9]{1,5}', required: false, hint: '无线调试主页显示的端口，可留空仅配对' }] },
  'mirror-console': { title: '投屏控制台', description: '设置 scrcpy 码率、最长边、帧率和控制模式。', fields: [{ name: 'bitrate', label: '视频码率（Mbps）', value: '12', pattern: '[0-9]{1,3}', hint: '范围 1 - 100' }, { name: 'maxSize', label: '画面最长边', value: '1920', pattern: '[0-9]{3,4}', hint: '范围 480 - 4320' }, { name: 'fps', label: '最高帧率', value: '60', pattern: '[0-9]{2,3}', hint: '范围 15 - 120' }, { name: 'control', label: '控制模式', type: 'select', value: 'control', options: [['control', '显示并控制'], ['view', '仅显示']] }] },
  'fastboot-set-active': { title: '切换启动槽位', description: '仅适用于 A/B 分区设备，切换错误可能导致无法启动。', fields: [{ name: 'slot', label: '目标槽位', type: 'select', value: 'a', options: [['a', '槽位 A'], ['b', '槽位 B']] }] },
  // 刷入 IMG：分区用下拉而不是自由文本。
  //
  // 原来让用户手打 "boot_a" 这种带槽位后缀的名字，问题是：
  //   1) 多数人不知道 A/B 机型必须带后缀，直接打 boot 会写到不存在的分区；
  //   2) 打错一个字母要到刷写中途才报错，那时镜像已经传了一部分；
  //   3) 界面按钮写的是"选择 A/B 槽位对应的 boot 镜像"，但没有任何槽位选择。
  // 现在拆成"分区类型 + 槽位"两个下拉，由程序拼装最终分区名，
  // 同时保留"自定义"入口给非常规分区（如 vendor_boot、recovery）。
  'flash-image': {
    title: '刷入 IMG',
    description: '必须确认镜像与目标分区、机型和系统版本完全匹配。A/B 机型请选对槽位——写错槽不会生效，覆盖备槽还会失去回滚能力。',
    fields: [
      {
        name: 'partition',
        label: '分区',
        type: 'select',
        value: 'boot',
        options: [
          ['boot', 'boot（内核 / ramdisk）'],
          ['init_boot', 'init_boot（Android 13+ 的 ramdisk）'],
          ['vendor_boot', 'vendor_boot（厂商内核模块）'],
          ['vbmeta', 'vbmeta（校验与 AVB）'],
          ['dtbo', 'dtbo（设备树叠加）'],
          ['recovery', 'recovery（旧机型恢复分区）'],
          ['custom', '自定义分区名…']
        ]
      },
      {
        name: 'customPartition',
        label: '自定义分区名',
        value: '',
        // 注意：pattern 会按 Chromium 的 v 模式（unicodeSets）编译，
        // 该模式下字符类里**不能出现字面连字符**，`-`、`\-`、`[-...]` 全部非法，
        // 必须写成 `\x2d`。写错的后果不是报错，而是整个 pattern 被静默忽略、
        // 表单校验失效（只有控制台留一行错误）。
        // scripts/audit-form-patterns.js 会在 CI 里挡住这类写法。
        pattern: '[A-Za-z0-9_\\x2d]+',
        required: false,
        hint: '仅在上面选“自定义”时填写，可带槽位后缀，例如 system_a'
      },
      {
        name: 'slot',
        label: '目标槽位',
        type: 'select',
        value: 'current',
        options: [
          ['current', '当前活动槽位（推荐，自动读取）'],
          ['a', '槽位 A'],
          ['b', '槽位 B'],
          ['none', '不带槽位后缀（单槽机型）']
        ]
      }
    ]
  },
  'gms-fix-app-license': { title: '修复依赖 Google 服务的应用', description: '放行 Google 服务后重新启动指定应用。', fields: [{ name: 'packageName', label: '目标应用包名', value: 'com.openai.chatgpt', pattern: '[A-Za-z0-9._]+' }] },
  // pattern 按 Chromium v 模式编译，连字符必须写 \x2d（详见 customPartition 处说明）
  'moto-bl-unlock': { title: 'Motorola Bootloader 解锁', description: '可先读取官网申请数据；拿到官方 Unlock Key 后再选择执行。解锁会清除数据。', fields: [{ name: 'mode', label: '操作', type: 'select', value: 'read', options: [['read', '读取解锁数据并打开官网'], ['unlock', '执行官方 Unlock Key']] }, { name: 'unlockKey', label: '官方 Unlock Key', value: '', required: false, pattern: '[A-Za-z0-9._\\x2d]*', hint: '读取数据时可留空；执行解锁码时必须填写' }] }
};

const $ = (id) => document.getElementById(id);
let currentPage = 'device';
let unreadLogs = 0;
let refreshTimer = null;
let installProgressTimer = null;
let taskTicker = null;
let firmwareXmlMode = 'auto';
let latestDeviceMode = '未连接';
let latestDeviceSerial = '';
/**
 * 设备当前活动槽位（'a' / 'b'，读不到时为空串）。
 *
 * 刷 boot 时"当前活动槽位"是最常用的选择，但它要在用户打开参数弹窗**之前**
 * 就已经拿到，所以在这里作为运行时状态缓存，由状态刷新写入。
 */
let latestDeviceSlot = '';
let logBuffer = '';
let lastErrorMessage = '';
const taskState = { current: null, history: [] };
let riskConfirmResolver = null;
const appManagerState = {
  apps: [],
  filter: 'user',
  sort: 'name-asc',
  query: '',
  selectedPackage: '',
  selectedPackages: new Set(),
  listScrollTop: 0,
  view: 'apps',
  intent: '',
  loading: false,
  error: '',
  storage: null,
  storageLoading: false,
  storageError: '',
  storageFiles: [],
  storageFileCategory: 'photos',
  storageFileSort: 'size-desc',
  selectedStorageFiles: new Set(),
  storageFileRecords: new Map(),
  storageFileLoading: false,
  storageFileError: '',
  storageFilePartial: false
};
const APP_MANAGER_ENTRIES = {
  'list-packages': { view: 'apps', intent: '' },
  'export-apk': { view: 'apps', intent: 'export' },
  'uninstall-package': { view: 'apps', intent: 'uninstall' },
  'clear-app-data': { view: 'storage', intent: 'clear' },
  'freeze-app-user0': { view: 'apps', intent: 'freeze' },
  'unfreeze-app-user0': { view: 'apps', intent: 'unfreeze' }
};
const APP_MANAGER_ACTIONS = {
  launch: 'launch-package',
  export: 'export-apk',
  clear: 'clear-app-data',
  freeze: 'freeze-app-user0',
  unfreeze: 'unfreeze-app-user0',
  uninstall: 'uninstall-package'
};
const APP_BATCH_ACTIONS = {
  export: { actionId: 'export-apks-batch', label: '批量导出 APK' },
  uninstall: { actionId: 'uninstall-packages-batch', label: '批量卸载应用', dangerous: true },
  freeze: { actionId: 'freeze-apps-user0-batch', label: '批量冻结应用', dangerous: true },
  unfreeze: { actionId: 'unfreeze-apps-user0-batch', label: '批量解冻应用' }
};
const APP_MANAGER_BUTTONS = {
  launch: '<button class="primary-button" data-app-action="launch" type="button"><i class="ph ph-play" aria-hidden="true"></i><span>启动应用</span></button>',
  export: '<button class="secondary-button" data-app-action="export" type="button"><i class="ph ph-export" aria-hidden="true"></i><span>导出 APK</span></button>',
  clear: '<button class="secondary-button" data-app-action="clear" type="button"><i class="ph ph-broom" aria-hidden="true"></i><span>清理数据</span></button>',
  freeze: '<button class="secondary-button" data-app-action="freeze" type="button"><i class="ph ph-snowflake" aria-hidden="true"></i><span>冻结应用</span></button>',
  unfreeze: '<button class="secondary-button" data-app-action="unfreeze" type="button"><i class="ph ph-sun" aria-hidden="true"></i><span>解冻应用</span></button>',
  uninstall: '<button class="primary-button danger-button" data-app-action="uninstall" type="button"><i class="ph ph-trash" aria-hidden="true"></i><span>卸载当前用户</span></button>'
};
const STORAGE_ACTIONS = {
  'clear-cache': {
    actionId: 'clear-storage-cache',
    label: '清理应用缓存',
    category: 'cache',
    message: '清理全部应用的可重建缓存，应用首次重新打开时可能加载较慢，确认继续？'
  },
  'clear-junk': {
    actionId: 'clear-storage-junk',
    label: '清理垃圾文件',
    category: 'junk',
    message: '将删除下载目录中的安装包、临时文件、日志、缩略图和回收站内容，确认继续？'
  },
  'clear-photos': {
    actionId: 'clear-storage-photos',
    label: '清理全部照片',
    category: 'photos',
    message: '将永久删除手机 DCIM 和 Pictures 目录中的全部照片，此操作不可恢复，确认继续？'
  },
  'clear-videos': {
    actionId: 'clear-storage-videos',
    label: '清理全部视频',
    category: 'videos',
    message: '将永久删除手机 DCIM、Movies 和 Pictures 目录中的全部视频，此操作不可恢复，确认继续？'
  }
};
const STORAGE_FILE_CATEGORIES = {
  photos: '照片',
  videos: '视频',
  downloads: '下载',
  documents: '文档'
};

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return `${size >= 100 ? size.toFixed(0) : size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${unit}`;
}

function formatFileModifiedAt(seconds) {
  const timestamp = Number(seconds) * 1000;
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '修改时间未知';
  return new Date(timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderLog() {
  const log = $('log');
  if (!log) return;
  const query = $('logSearch')?.value.trim() || '';
  log.replaceChildren();
  if (!query) {
    log.textContent = logBuffer;
    $('logMatchCount').textContent = logBuffer ? `${logBuffer.split(/\r?\n/).filter(Boolean).length} 条` : '0 条';
  } else {
    const fragment = document.createDocumentFragment();
    const matcher = new RegExp(escapeRegExp(query), 'gi');
    let cursor = 0;
    let matches = 0;
    let match;
    while ((match = matcher.exec(logBuffer))) {
      fragment.appendChild(document.createTextNode(logBuffer.slice(cursor, match.index)));
      const mark = document.createElement('mark');
      mark.textContent = match[0];
      fragment.appendChild(mark);
      cursor = match.index + match[0].length;
      matches += 1;
    }
    fragment.appendChild(document.createTextNode(logBuffer.slice(cursor)));
    log.appendChild(fragment);
    $('logMatchCount').textContent = `${matches} 条匹配`;
  }
  log.scrollTop = log.scrollHeight;
}

function appendLog(text) {
  logBuffer += text;
  const progress = String(text).match(/\[任务进度\]\s+(\d+)\/(\d+)\s+(.+)/);
  if (progress && taskState.current?.state === 'running') {
    updateTaskProgress(Number(progress[1]), Number(progress[2]), progress[3].trim());
  }
  renderLog();
  if (currentPage !== 'log') {
    unreadLogs += 1;
    $('logBadge').textContent = unreadLogs > 99 ? '99+' : String(unreadLogs);
    $('logBadge').hidden = false;
  }
}

window.gaoji.onLog(appendLog);

function setText(id, value, fallback = '-') {
  $(id).textContent = value || fallback;
}

function firstDevice(status) {
  return status.adbDevices?.[0]?.serial || status.fastbootDevices?.[0]?.serial || '';
}

function connectionState(mode) {
  if (mode === '系统模式') return 'online';
  if (mode === 'Fastboot') return 'fastboot';
  if (mode === '未授权') return 'unauthorized';
  return 'offline';
}

function updateDeviceSelect(status) {
  const select = $('deviceSelect');
  const previousValue = select.value;
  const devices = [...(status.adbDevices || []), ...(status.fastbootDevices || [])];
  select.replaceChildren();
  if (!devices.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '未连接';
    select.appendChild(option);
    return;
  }
  for (const device of devices) {
    const option = document.createElement('option');
    option.value = device.serial;
    option.dataset.transport = device.state === 'fastboot' ? 'fastboot' : 'adb';
    option.textContent = `${device.serial} (${device.state})`;
    select.appendChild(option);
  }
  if (devices.some((device) => device.serial === previousValue)) select.value = previousValue;
}

function updateRebootAvailability() {
  const connected = latestDeviceMode === '系统模式' || latestDeviceMode === 'Fastboot';
  document.querySelectorAll('[data-action="reboot-system"], [data-action="adb-reboot-system"], [data-action="reboot-recovery"], [data-action="reboot-fastboot"]').forEach((button) => {
    button.disabled = !connected;
    button.title = connected ? '' : '请先连接并授权 ADB，或进入 Fastboot。';
  });
  document.querySelectorAll('[data-action="fastboot-reboot"]').forEach((button) => {
    button.disabled = latestDeviceMode !== 'Fastboot';
    button.title = latestDeviceMode === 'Fastboot' ? '' : '仅在设备已进入 Fastboot 时可用。';
  });
}

function updateBattery(status) {
  const batteryLine = status.props?.battery || '';
  const match = batteryLine.match(/(\d+)/);
  const track = document.querySelector('.battery-track');
  if (!match) {
    $('batteryFill').style.width = '0%';
    $('batteryText').textContent = '未知';
    track.setAttribute('aria-valuenow', '0');
    return;
  }
  const level = Math.max(0, Math.min(100, Number(match[1])));
  $('batteryFill').style.width = `${level}%`;
  $('batteryText').textContent = `${level}%`;
  track.setAttribute('aria-valuenow', String(level));
}

function updateStatusUI(status) {
  const mode = status.mode || '未连接';
  latestDeviceMode = mode;
  const state = connectionState(mode);
  const serial = firstDevice(status);
  latestDeviceSerial = serial;
  const model = status.props?.model || '';

  $('modePill').dataset.state = state;
  $('modePill').querySelector('span:last-child').textContent = mode;
  $('sidebarConnection').dataset.state = state;
  $('sidebarMode').textContent = mode;
  $('sidebarDevice').textContent = serial || '等待设备';
  $('deviceName').textContent = model || serial || '未检测到设备';
  $('heroStatus').textContent = status.deviceText || '请连接手机并开启 USB 调试';
  setText('connectionModeText', mode, '未连接');
  latestDeviceSlot = String(status.props?.slot || '').replace(/^_/, '').toLowerCase();
  if (!/^[ab]$/.test(latestDeviceSlot)) latestDeviceSlot = '';
  setText('slotText', latestDeviceSlot ? latestDeviceSlot.toUpperCase() : '', '-');
  $('recommendationTitle').textContent = mode === '未连接' ? '先连接手机并完成 USB 调试授权' : mode === '未授权' ? '请在手机上确认 USB 调试授权' : mode === 'Fastboot' ? '设备已进入 Fastboot，请先核对机型和操作目标' : '设备已连接，可以选择需要执行的功能';
  $('recommendationText').textContent = mode === '未连接' ? '连接向导会区分未连接、未授权、ADB 和 Fastboot 状态。' : status.deviceText || '设备状态已更新。';

  setText('manufacturer', status.props?.manufacturer);
  setText('deviceCode', status.props?.device);
  setText('androidVersion', status.props?.android);
  setText('model', model);
  setText('serial', serial);
  setText('cpu', status.props?.cpu);
  setText('rootStatus', status.root?.ok ? '已授权' : mode === '系统模式' ? '未授权' : '未知', '未知');
  setText('magiskStatus', status.magisk?.state, '未知');
  updateBattery(status);
  updateDeviceSelect(status);
  updateRebootAvailability();
}

function setTaskStatus(state, message) {
  const taskStatus = $('taskStatus');
  const icon = taskStatus.querySelector('i');
  taskStatus.dataset.state = state;
  taskStatus.querySelector('span').textContent = message;
  icon.className = `ph ${taskIcon(state)}`;
  const meta = $('taskStatusMeta');
  if (meta) meta.textContent = taskState.current?.state === 'running' ? formatDuration(Date.now() - taskState.current.startedAt) : '';
  $('copyTaskError').hidden = state !== 'error' || !lastErrorMessage;
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function taskIcon(state) {
  if (state === 'running') return 'ph-spinner-gap';
  if (state === 'error') return 'ph-warning-circle';
  if (state === 'warning') return 'ph-warning';
  return 'ph-check-circle';
}

function renderTaskCenter() {
  const current = taskState.current;
  const summary = $('taskCenterSummary');
  const currentTitle = $('currentTaskTitle');
  const currentDetail = $('currentTaskDetail');
  const currentTime = $('currentTaskTime');
  const currentPanel = $('taskCenterCurrent');
  if (current) {
    currentPanel.dataset.state = current.state;
    currentPanel.querySelector('.task-center-state i').className = `ph ${taskIcon(current.state)}`;
    currentTitle.textContent = current.label;
    currentDetail.textContent = current.message;
    currentTime.textContent = current.state === 'running' ? `已运行 ${formatDuration(Date.now() - current.startedAt)}` : formatDuration(current.durationMs || 0);
    summary.textContent = current.state === 'running' ? '正在执行 1 个任务' : `最近完成：${current.label}`;
  } else {
    currentPanel.dataset.state = 'idle';
    currentPanel.querySelector('.task-center-state i').className = 'ph ph-check-circle';
    currentTitle.textContent = '准备就绪';
    currentDetail.textContent = '等待执行操作';
    currentTime.textContent = '--';
    summary.textContent = '当前没有正在执行的任务';
  }
  const history = $('taskHistory');
  history.replaceChildren();
  if (!taskState.history.length) {
    const empty = document.createElement('div');
    empty.className = 'task-history-empty';
    empty.textContent = '暂无任务记录';
    history.appendChild(empty);
    return;
  }
  for (const item of taskState.history) {
    const row = document.createElement('div');
    row.className = 'task-history-item';
    row.dataset.state = item.state;
    row.innerHTML = `<i class="ph ph-circle-fill" aria-hidden="true"></i><div><strong></strong><small></small></div><time></time>`;
    row.querySelector('strong').textContent = item.label;
    row.querySelector('small').textContent = `${item.message}${item.code === undefined ? '' : ` · 退出码 ${item.code}`} · ${formatDuration(item.durationMs)}`;
    row.querySelector('time').textContent = item.finishedAt;
    history.appendChild(row);
  }
}

function beginTask(label, action, total = 0) {
  if (taskState.current?.state === 'running') {
    setTaskStatus('warning', `已有任务正在执行：${taskState.current.label}`);
    return false;
  }
  taskState.current = { label, action, state: 'running', message: '正在准备，请稍候...', total, completed: 0, startedAt: Date.now() };
  lastErrorMessage = '';
  window.clearInterval(taskTicker);
  taskTicker = window.setInterval(() => {
    if (taskState.current?.state === 'running') {
      setTaskStatus('running', `正在执行：${taskState.current.label} · ${taskState.current.message}`);
      renderTaskCenter();
    }
  }, 1000);
  setTaskStatus('running', `正在执行：${label}`);
  renderTaskCenter();
  return true;
}

function updateTaskProgress(completed, total, detail = '') {
  const current = taskState.current;
  if (!current || current.state !== 'running') return;
  current.completed = Math.max(0, Math.min(Number(completed) || 0, Number(total) || 0));
  current.total = Math.max(0, Number(total) || 0);
  current.message = current.total ? `已完成 ${current.completed} / ${current.total}${detail ? `：${detail}` : ''}` : (detail || '正在执行，请稍候...');
  setTaskStatus('running', `正在执行：${current.label} · ${current.message}`);
  renderTaskCenter();
}

function finishTask(state, message, code) {
  if (!taskState.current) {
    setTaskStatus(state, message);
    return;
  }
  const current = taskState.current;
  current.state = state;
  current.message = message;
  current.code = code;
  current.durationMs = Date.now() - current.startedAt;
  current.finishedAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  taskState.history.unshift({ ...current });
  taskState.history = taskState.history.slice(0, 20);
  window.clearInterval(taskTicker);
  taskTicker = null;
  setTaskStatus(state, message);
  renderTaskCenter();
}

function validateActionContext(action) {
  if (FASTBOOT_REQUIRED_ACTIONS.has(action) && latestDeviceMode !== 'Fastboot') return '当前设备未处于 Fastboot，已阻止危险操作。';
  if (ADB_REQUIRED_ACTIONS.has(action) && latestDeviceMode !== '系统模式') return '当前设备未处于已授权的系统模式，已阻止操作。';
  return '';
}

function askRiskConfirmation({ message, action, target }) {
  const dialog = $('riskConfirmDialog');
  $('riskConfirmMessage').textContent = message;
  $('riskConfirmDevice').textContent = latestDeviceSerial || '未连接';
  $('riskConfirmMode').textContent = latestDeviceMode;
  $('riskConfirmTarget').textContent = target || action || '-';
  return new Promise((resolve) => {
    riskConfirmResolver = resolve;
    dialog.showModal();
  });
}

function settleRiskConfirmation(value) {
  if (riskConfirmResolver) riskConfirmResolver(value);
  riskConfirmResolver = null;
  $('riskConfirmDialog').close();
}

function labelForFeature(action) {
  if (FEATURE_LABELS[action]) return FEATURE_LABELS[action];
  return action.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renderFeatureGroup(group, target) {
  if (!target) return;
  target.replaceChildren();
  const actions = FEATURE_GROUPS[group] || [];
  for (const action of actions) {
    const button = document.createElement('button');
    button.className = `command-tile feature-tile${FEATURE_DANGER.has(action) ? ' danger-tile' : ''}`;
    button.dataset.action = action;
    if (FEATURE_DANGER.has(action)) button.dataset.confirm = `${labelForFeature(action)}可能修改设备或应用状态，确认继续？`;
    button.innerHTML = `<span class="command-icon"><i class="ph ${FEATURE_DANGER.has(action) ? 'ph-warning' : 'ph-wrench'}" aria-hidden="true"></i></span><span class="command-copy"><strong></strong><small></small></span><i class="ph ph-caret-right command-arrow" aria-hidden="true"></i>`;
    button.querySelector('strong').textContent = labelForFeature(action);
    button.querySelector('small').textContent = FEATURE_DESCRIPTIONS[group] || '原版工作台功能入口，执行结果会保留在运行日志。';
    target.appendChild(button);
  }
}

function renderFeatureDirectory(group = 'diagnose') {
  renderFeatureGroup(group, $('advancedFeatures'));
  const count = Object.values(FEATURE_GROUPS).flat().length;
  $('featureCount').textContent = `${count} 个功能入口`;
  document.querySelectorAll('[data-feature-tab]').forEach((tab) => tab.classList.toggle('active', tab.dataset.featureTab === group));
}

function initializeFeaturePages() {
  renderFeatureGroup('apps', document.querySelector('[data-feature-group="apps"]'));
  renderFeatureGroup('repair', document.querySelector('[data-feature-group="repair"]'));
  renderFeatureDirectory();
  document.querySelectorAll('[data-feature-tab]').forEach((tab) => {
    tab.addEventListener('click', () => renderFeatureDirectory(tab.dataset.featureTab));
  });
}

async function refreshStatus(options = {}) {
  const refreshButton = $('refresh');
  refreshButton.classList.add('is-loading');
  try {
    const status = await window.gaoji.getStatus();
    updateStatusUI(status);
    if (options.announce) setTaskStatus('success', '设备状态已刷新');
  } catch (error) {
    appendLog(`\n[状态刷新失败] ${error.message}\n`);
    setTaskStatus('error', '状态刷新失败，请查看日志');
  } finally {
    refreshButton.classList.remove('is-loading');
  }
}

function switchPage(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach((nav) => nav.classList.toggle('active', nav.dataset.page === page));
  document.querySelectorAll('.page').forEach((element) => element.classList.toggle('active', element.id === `page-${page}`));
  $('pageTitle').textContent = pages[page][0];
  $('pageSub').textContent = pages[page][1];
  document.querySelector(`.nav-item[data-page="${page}"]`)?.scrollIntoView({ block: 'nearest' });
  if (page === 'log') {
    unreadLogs = 0;
    $('logBadge').hidden = true;
  }
}

function filteredApps() {
  const query = appManagerState.query.trim().toLocaleLowerCase('zh-CN');
  const compareName = (a, b) => a.label.localeCompare(b.label, 'zh-CN') || a.packageName.localeCompare(b.packageName);
  const compareApps = (a, b) => {
    switch (appManagerState.sort) {
      case 'name-desc': return -compareName(a, b);
      case 'size-desc': return (Number(b.sizeBytes) || 0) - (Number(a.sizeBytes) || 0) || compareName(a, b);
      case 'size-asc': return (Number(a.sizeBytes) || 0) - (Number(b.sizeBytes) || 0) || compareName(a, b);
      case 'type-user': return Number(a.system) - Number(b.system) || compareName(a, b);
      case 'type-system': return Number(b.system) - Number(a.system) || compareName(a, b);
      case 'state-frozen': return Number(b.frozen) - Number(a.frozen) || compareName(a, b);
      case 'state-enabled': return Number(a.frozen) - Number(b.frozen) || compareName(a, b);
      default: return compareName(a, b);
    }
  };
  return appManagerState.apps.filter((app) => {
    const category = appManagerState.filter === 'all'
      || (appManagerState.filter === 'user' && !app.system)
      || (appManagerState.filter === 'system' && app.system)
      || (appManagerState.filter === 'frozen' && app.frozen);
    const text = `${app.label} ${app.packageName}`.toLocaleLowerCase('zh-CN');
    return category && (!query || text.includes(query));
  }).sort(compareApps);
}

function renderAppDetail(app) {
  const detail = $('appManagerDetail');
  detail.replaceChildren();
  if (!app) {
    const empty = document.createElement('div');
    empty.className = 'app-detail-empty';
    empty.textContent = '选择一个应用查看详情';
    detail.appendChild(empty);
    return;
  }

  const heading = document.createElement('div');
  heading.className = 'app-detail-heading';
  const title = document.createElement('h3');
  title.textContent = app.label;
  const packageName = document.createElement('p');
  packageName.textContent = app.packageName;
  heading.append(title, packageName);

  const grid = document.createElement('div');
  grid.className = 'app-detail-grid';
  for (const [label, value] of [
    ['版本', app.versionName || '-'],
    ['类型', app.system ? '系统应用' : '用户应用'],
    ['占用空间', app.sizeBytes ? formatBytes(app.sizeBytes) : '系统未提供'],
    ['缓存', app.cacheBytes ? formatBytes(app.cacheBytes) : '0 B'],
    ['状态', app.frozen ? '已冻结' : '正常'],
    ['存储位置', app.storage === 'external' ? '外部存储' : '内部存储'],
    ['启动入口', app.launchable ? '可启动' : '无启动入口'],
    ['启用状态', app.enabled ? '已启用' : '已停用']
  ]) {
    const cell = document.createElement('div');
    const caption = document.createElement('span');
    const strong = document.createElement('strong');
    caption.textContent = label;
    strong.textContent = value;
    cell.append(caption, strong);
    grid.appendChild(cell);
  }

  const actions = document.createElement('div');
  actions.className = 'app-detail-actions';
  actions.innerHTML = [APP_MANAGER_BUTTONS.launch, APP_MANAGER_BUTTONS.export, APP_MANAGER_BUTTONS.clear,
    app.frozen ? APP_MANAGER_BUTTONS.unfreeze : APP_MANAGER_BUTTONS.freeze,
    app.system ? '' : APP_MANAGER_BUTTONS.uninstall].join('');
  actions.querySelector(`[data-app-action="${appManagerState.intent}"]`)?.classList.add('is-recommended');
  const launch = actions.querySelector('[data-app-action="launch"]');
  launch.disabled = !app.launchable;
  launch.title = app.launchable ? '在手机上启动应用' : '此应用没有可用的启动入口';
  detail.append(heading, grid, actions);
}

function selectedApps() {
  return appManagerState.apps.filter((app) => appManagerState.selectedPackages.has(app.packageName));
}

function eligibleBatchApps(action) {
  const apps = selectedApps();
  if (action === 'uninstall') return apps.filter((app) => !app.system);
  if (action === 'freeze') return apps.filter((app) => !app.frozen);
  if (action === 'unfreeze') return apps.filter((app) => app.frozen);
  return apps;
}

function renderAppBatchToolbar(visibleApps) {
  const selected = selectedApps();
  const selectedVisible = visibleApps.filter((app) => appManagerState.selectedPackages.has(app.packageName));
  const selectAll = $('selectAllVisibleApps');
  selectAll.disabled = appManagerState.loading || !visibleApps.length;
  selectAll.checked = Boolean(visibleApps.length) && selectedVisible.length === visibleApps.length;
  selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleApps.length;
  $('selectedAppCount').textContent = `已选 ${selected.length} 项`;
  document.querySelectorAll('[data-app-batch-action]').forEach((button) => {
    const eligible = eligibleBatchApps(button.dataset.appBatchAction);
    button.disabled = appManagerState.loading || !eligible.length;
    button.title = eligible.length ? `将处理 ${eligible.length} 个应用` : '当前选择中没有可执行此操作的应用';
  });
}

function renderAppManager() {
  const previousScrollTop = Math.max(0, Number(appManagerState.listScrollTop) || 0);
  const apps = filteredApps();
  if (!apps.some((app) => app.packageName === appManagerState.selectedPackage)) {
    appManagerState.selectedPackage = apps[0]?.packageName || '';
  }
  const selected = apps.find((app) => app.packageName === appManagerState.selectedPackage);
  $('appManagerSummary').textContent = appManagerState.loading
    ? '正在读取手机应用'
    : `当前显示 ${apps.length} 个，共 ${appManagerState.apps.length} 个应用`;
  const message = $('appManagerMessage');
  message.textContent = appManagerState.loading ? '正在读取应用名称、包名和状态...' : appManagerState.error;
  message.dataset.state = appManagerState.error ? 'error' : appManagerState.loading ? 'loading' : '';

  const counts = {
    user: appManagerState.apps.filter((app) => !app.system).length,
    system: appManagerState.apps.filter((app) => app.system).length,
    frozen: appManagerState.apps.filter((app) => app.frozen).length,
    all: appManagerState.apps.length
  };
  document.querySelectorAll('[data-app-filter]').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.appFilter === appManagerState.filter);
    tab.querySelector('span').textContent = String(counts[tab.dataset.appFilter] || 0);
  });
  renderAppBatchToolbar(apps);

  const list = $('appManagerList');
  list.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const app of apps) {
    const row = document.createElement('div');
    row.className = 'app-list-item';
    row.dataset.packageName = app.packageName;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(app.packageName === appManagerState.selectedPackage));
    row.classList.toggle('is-batch-selected', appManagerState.selectedPackages.has(app.packageName));
    const checkbox = document.createElement('input');
    checkbox.className = 'app-select-checkbox';
    checkbox.type = 'checkbox';
    checkbox.checked = appManagerState.selectedPackages.has(app.packageName);
    checkbox.dataset.appSelect = app.packageName;
    checkbox.setAttribute('aria-label', `选择 ${app.label}`);
    const open = document.createElement('button');
    open.className = 'app-list-open';
    open.type = 'button';
    open.dataset.appOpen = app.packageName;
    const copy = document.createElement('span');
    const label = document.createElement('strong');
    const pkg = document.createElement('small');
    label.textContent = app.label;
    pkg.textContent = app.packageName;
    copy.append(label, pkg);
    open.appendChild(copy);
    const meta = document.createElement('span');
    meta.className = 'app-list-meta';
    const size = document.createElement('span');
    size.className = 'app-list-size';
    size.textContent = app.sizeBytes ? formatBytes(app.sizeBytes) : '--';
    meta.appendChild(size);
    if (app.frozen) {
      const badge = document.createElement('span');
      badge.className = 'app-state-badge';
      badge.textContent = '已冻结';
      meta.appendChild(badge);
    }
    row.append(checkbox, open, meta);
    fragment.appendChild(row);
  }
  if (!apps.length) {
    const empty = document.createElement('div');
    empty.className = 'app-list-empty';
    empty.textContent = appManagerState.loading ? '正在读取...' : '没有符合条件的应用';
    fragment.appendChild(empty);
  }
  list.appendChild(fragment);
  const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
  list.scrollTop = Math.min(previousScrollTop, maxScrollTop);
  renderAppDetail(selected);
}

async function loadAppManager(preferredPackage = appManagerState.selectedPackage, { allowActiveTask = false } = {}) {
  const active = taskState.current?.state === 'running';
  if (active && !allowActiveTask) {
    setTaskStatus('warning', `已有任务正在执行：${taskState.current.label}`);
    return;
  }
  const ownsTask = !active;
  if (ownsTask && !beginTask('扫描应用列表', 'list-packages')) return;
  const selectedDevice = $('deviceSelect').selectedOptions[0];
  const payload = { serial: selectedDevice?.value || '', transport: selectedDevice?.dataset.transport || '' };
  appManagerState.loading = true;
  appManagerState.error = '';
  renderAppManager();
  try {
    const result = await window.gaoji.run('list-packages', payload);
    if (result.code !== 0 || !Array.isArray(result.data?.apps)) {
      appManagerState.apps = [];
      appManagerState.selectedPackage = '';
      appManagerState.error = result.stderr || result.stdout || '应用列表读取失败。';
      appendLog(`\n[应用列表] ${appManagerState.error}\n`);
      setTaskStatus('error', '应用列表读取失败');
      if (ownsTask) finishTask('error', '应用列表读取失败', result.code);
      return;
    }
    appManagerState.apps = result.data.apps;
    const availablePackages = new Set(appManagerState.apps.map((app) => app.packageName));
    appManagerState.selectedPackages = new Set([...appManagerState.selectedPackages].filter((packageName) => availablePackages.has(packageName)));
    appManagerState.selectedPackage = appManagerState.apps.some((app) => app.packageName === preferredPackage) ? preferredPackage : '';
    setTaskStatus('success', `已读取 ${appManagerState.apps.length} 个应用`);
    if (ownsTask) finishTask('success', `应用列表扫描完成：${appManagerState.apps.length} 个`, result.code);
  } catch (error) {
    appManagerState.apps = [];
    appManagerState.selectedPackage = '';
    appManagerState.error = error.message;
    appendLog(`\n[应用列表失败] ${error.message}\n`);
    setTaskStatus('error', '应用列表读取失败');
    if (ownsTask) finishTask('error', '应用列表读取失败');
  } finally {
    appManagerState.loading = false;
    renderAppManager();
  }
}

function renderStorageManager() {
  const storage = appManagerState.storage;
  const message = $('storageManagerMessage');
  message.textContent = appManagerState.storageLoading
    ? '正在读取应用、媒体、缓存和下载目录的真实占用...'
    : appManagerState.storageError || appManagerState.storageResult || '';
  message.dataset.state = appManagerState.storageError ? 'error' : appManagerState.storageLoading ? 'loading' : appManagerState.storageResult ? 'success' : '';
  $('storageUsageText').textContent = storage ? `${formatBytes(storage.usedBytes)} / ${formatBytes(storage.totalBytes)}` : '等待扫描';
  $('storageFreeText').textContent = storage ? `可用空间 ${formatBytes(storage.freeBytes)}` : '连接设备后读取真实占用';
  const percent = storage?.totalBytes ? Math.min(100, Math.round((storage.usedBytes / storage.totalBytes) * 100)) : 0;
  $('storageUsageBar').style.width = `${percent}%`;
  document.querySelectorAll('[data-storage-category]').forEach((category) => {
    const details = storage?.categories?.[category.dataset.storageCategory];
    category.querySelector('[data-storage-value]').textContent = details ? formatBytes(details.bytes) : '--';
    const meta = details
      ? `${details.count === null ? '数量读取失败' : `${details.count} ${details.unit}`} · ${details.paths.join('、')}`
      : '等待扫描数量和占用空间';
    category.querySelector('[data-storage-meta]').textContent = meta;
    category.querySelector('[data-storage-meta]').title = meta;
  });
  renderStorageFiles();
}

function renderStorageFiles() {
  const category = STORAGE_FILE_CATEGORIES[appManagerState.storageFileCategory] || '文件';
  const files = sortedStorageFiles();
  const selectedVisible = files.filter((file) => appManagerState.selectedStorageFiles.has(file.path));
  document.querySelectorAll('[data-storage-file-category]').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.storageFileCategory === appManagerState.storageFileCategory);
    tab.disabled = appManagerState.storageFileLoading;
  });
  $('storageFileSort').disabled = appManagerState.storageFileLoading;
  const selectAll = $('selectAllStorageFiles');
  selectAll.disabled = appManagerState.storageFileLoading || !files.length;
  selectAll.checked = Boolean(files.length) && selectedVisible.length === files.length;
  selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < files.length;
  $('selectedStorageFileCount').textContent = `已选 ${appManagerState.selectedStorageFiles.size} 项`;
  document.querySelectorAll('[data-storage-file-action]').forEach((button) => {
    button.disabled = appManagerState.storageFileLoading || !appManagerState.selectedStorageFiles.size;
  });
  $('storageFileSummary').textContent = appManagerState.storageFileLoading
    ? `正在读取${category}...`
    : files.length ? `${category} ${files.length} 个文件` : `未读取${category}`;
  const message = $('storageFileMessage');
  message.textContent = appManagerState.storageFileLoading
    ? '正在读取名称、完整路径、大小和修改时间...'
    : appManagerState.storageFileError || (appManagerState.storageFilePartial ? '部分目录不可访问，已显示可读取文件。' : '');
  message.dataset.state = appManagerState.storageFileError ? 'error' : appManagerState.storageFileLoading ? 'loading' : appManagerState.storageFilePartial ? 'warning' : '';
  const list = $('storageFileList');
  list.replaceChildren();
  if (!files.length) {
    const empty = document.createElement('div');
    empty.className = 'storage-file-empty';
    empty.textContent = appManagerState.storageFileLoading ? '正在读取文件列表...' : `未找到${category}`;
    list.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const file of files) {
    const row = document.createElement('div');
    row.className = 'storage-file-row';
    row.setAttribute('role', 'listitem');
    const checkbox = document.createElement('input');
    checkbox.className = 'storage-file-select';
    checkbox.type = 'checkbox';
    checkbox.checked = appManagerState.selectedStorageFiles.has(file.path);
    checkbox.dataset.storageFileSelect = file.path;
    checkbox.setAttribute('aria-label', `选择 ${file.path.split('/').pop() || file.path}`);
    const icon = document.createElement('i');
    icon.className = `ph ${appManagerState.storageFileCategory === 'videos' ? 'ph-video-camera' : appManagerState.storageFileCategory === 'photos' ? 'ph-image' : 'ph-file'}`;
    icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('div');
    const name = document.createElement('strong');
    const location = document.createElement('small');
    name.textContent = file.path.split('/').pop() || file.path;
    location.textContent = file.path;
    copy.append(name, location);
    const meta = document.createElement('div');
    meta.innerHTML = '<strong></strong><small></small>';
    meta.querySelector('strong').textContent = formatBytes(file.bytes);
    meta.querySelector('small').textContent = formatFileModifiedAt(file.modifiedAt);
    row.append(checkbox, icon, copy, meta);
    fragment.appendChild(row);
  }
  list.appendChild(fragment);
}

function sortedStorageFiles() {
  const compareName = (a, b) => a.path.localeCompare(b.path, 'zh-CN');
  const compare = (a, b) => {
    switch (appManagerState.storageFileSort) {
      case 'size-asc': return Number(a.bytes) - Number(b.bytes) || compareName(a, b);
      case 'time-desc': return Number(b.modifiedAt) - Number(a.modifiedAt) || compareName(a, b);
      case 'time-asc': return Number(a.modifiedAt) - Number(b.modifiedAt) || compareName(a, b);
      case 'name-desc': return -compareName(a, b);
      case 'name-asc': return compareName(a, b);
      default: return Number(b.bytes) - Number(a.bytes) || compareName(a, b);
    }
  };
  return [...appManagerState.storageFiles].sort(compare);
}

function setAppManagerView(view) {
  appManagerState.view = view === 'storage' ? 'storage' : 'apps';
  $('appManagerAppView').hidden = appManagerState.view !== 'apps';
  $('storageManagerView').hidden = appManagerState.view !== 'storage';
  document.querySelectorAll('[data-app-manager-view]').forEach((tab) => tab.classList.toggle('active', tab.dataset.appManagerView === appManagerState.view));
  const intentTitles = { export: '导出 APK', uninstall: '卸载应用', clear: '清理数据', freeze: '冻结应用', unfreeze: '解冻应用' };
  $('appManagerTitle').textContent = appManagerState.view === 'storage' ? '存储清理' : (intentTitles[appManagerState.intent] || '应用管理');
  $('appManagerSummary').textContent = appManagerState.view === 'storage'
    ? '按应用、照片、视频、缓存和垃圾文件查看真实占用'
    : (appManagerState.loading ? '正在读取手机应用' : `当前显示 ${filteredApps().length} 个，共 ${appManagerState.apps.length} 个应用`);
  $('refreshAppManager').querySelector('span').textContent = appManagerState.view === 'storage' ? '重新扫描' : '刷新列表';
}

async function loadStorageSummary({ allowActiveTask = false } = {}) {
  const active = taskState.current?.state === 'running';
  if (active && !allowActiveTask) {
    setTaskStatus('warning', `已有任务正在执行：${taskState.current.label}`);
    return;
  }
  const ownsTask = !active;
  if (ownsTask && !beginTask('扫描存储空间', 'storage-summary')) return;
  const selectedDevice = $('deviceSelect').selectedOptions[0];
  const payload = { serial: selectedDevice?.value || '', transport: selectedDevice?.dataset.transport || '' };
  appManagerState.storageLoading = true;
  appManagerState.storageError = '';
  appManagerState.storageResult = '';
  renderStorageManager();
  try {
    const result = await window.gaoji.run('storage-summary', payload);
    if (result.code !== 0 || !result.data?.storage) {
      appManagerState.storage = null;
      appManagerState.storageError = result.stderr || result.stdout || '存储空间读取失败。';
      appendLog(`\n[存储扫描] ${appManagerState.storageError}\n`);
      setTaskStatus('error', '存储空间读取失败');
      if (ownsTask) finishTask('error', '存储空间读取失败', result.code);
      return;
    }
    appManagerState.storage = result.data.storage;
    setTaskStatus('success', '存储空间扫描完成');
    if (ownsTask) finishTask('success', '存储空间扫描完成', result.code);
  } catch (error) {
    appManagerState.storage = null;
    appManagerState.storageError = error.message;
    appendLog(`\n[存储扫描失败] ${error.message}\n`);
    setTaskStatus('error', '存储空间读取失败');
    if (ownsTask) finishTask('error', '存储空间读取失败');
  } finally {
    appManagerState.storageLoading = false;
    renderStorageManager();
  }
}

async function loadStorageFiles(category) {
  const label = STORAGE_FILE_CATEGORIES[category];
  if (!label) return;
  if (!beginTask(`浏览${label}`, 'list-storage-files')) return;
  const selectedDevice = $('deviceSelect').selectedOptions[0];
  appManagerState.storageFileCategory = category;
  appManagerState.storageFiles = [];
  appManagerState.storageFileLoading = true;
  appManagerState.storageFileError = '';
  appManagerState.storageFilePartial = false;
  renderStorageFiles();
  try {
    const result = await window.gaoji.run('list-storage-files', { category, serial: selectedDevice?.value || '', transport: selectedDevice?.dataset.transport || '' });
    if (result.code !== 0 || !Array.isArray(result.data?.files)) {
      appManagerState.storageFileError = result.stderr || result.stdout || `${label}读取失败。`;
      appendLog(`\n[文件浏览] ${appManagerState.storageFileError}\n`);
      finishTask('error', `${label}读取失败`, result.code);
      return;
    }
    appManagerState.storageFiles = result.data.files.sort((a, b) => Number(b.bytes) - Number(a.bytes) || Number(b.modifiedAt) - Number(a.modifiedAt));
    result.data.files.forEach((file) => appManagerState.storageFileRecords.set(file.path, file));
    appManagerState.storageFilePartial = Boolean(result.data.partial);
    finishTask(result.data.partial ? 'warning' : 'success', `${label}读取完成：${appManagerState.storageFiles.length} 个文件`, result.code);
  } catch (error) {
    appManagerState.storageFileError = error.message;
    appendLog(`\n[文件浏览失败] ${error.message}\n`);
    finishTask('error', `${label}读取失败`);
  } finally {
    appManagerState.storageFileLoading = false;
    renderStorageFiles();
  }
}

async function exportSelectedStorageFiles() {
  const files = [...appManagerState.selectedStorageFiles].map((filePath) => appManagerState.storageFileRecords.get(filePath)).filter(Boolean);
  if (!files.length || !beginTask('导出手机文件', 'export-storage-files', files.length)) return;
  const selectedDevice = $('deviceSelect').selectedOptions[0];
  try {
    const result = await window.gaoji.run('export-storage-files', { serial: selectedDevice?.value || '', transport: selectedDevice?.dataset.transport || '', files });
    const succeeded = Array.isArray(result.data?.succeeded) ? result.data.succeeded : [];
    const failed = Array.isArray(result.data?.failed) ? result.data.failed : [];
    const invalid = Array.isArray(result.data?.invalid) ? result.data.invalid : [];
    succeeded.forEach((filePath) => appManagerState.selectedStorageFiles.delete(filePath));
    if (result.code === 0) finishTask('success', `文件导出完成：${succeeded.length} 个`, result.code);
    else finishTask('error', `文件导出完成，但有 ${failed.length} 个失败项${invalid.length ? `、${invalid.length} 个无效路径` : ''}`, result.code);
    appManagerState.storageFileError = result.code === 0 ? '' : (result.stderr || result.stdout || '文件导出存在失败项。');
  } catch (error) {
    appManagerState.storageFileError = error.message;
    finishTask('error', '文件导出失败');
  } finally {
    renderStorageFiles();
  }
}

function previewSelectedStorageFileDelete() {
  const files = [...appManagerState.selectedStorageFiles].map((filePath) => appManagerState.storageFileRecords.get(filePath)).filter(Boolean);
  if (!files.length || !beginTask('文件删除预演', 'storage-delete-preview', files.length)) return;
  const summary = files.slice(0, 4).map((file) => file.path).join('、');
  const suffix = files.length > 4 ? ` 等 ${files.length} 个文件` : '';
  appManagerState.storageFileError = `删除预演：${files.length} 个文件，共 ${formatBytes(files.reduce((sum, file) => sum + Number(file.bytes || 0), 0))}；${summary}${suffix}。未执行任何删除。`;
  finishTask('warning', '已生成文件删除预演，未修改手机文件');
  renderStorageFiles();
}

function openAppManager(view = 'apps', intent = '') {
  const dialog = $('appManagerDialog');
  appManagerState.intent = intent;
  appManagerState.query = '';
  $('appManagerSearch').value = '';
  setAppManagerView(view);
  if (!dialog.open) dialog.showModal();
  if (appManagerState.view === 'storage') loadStorageSummary();
  else {
    loadAppManager();
    $('appManagerSearch').focus();
  }
}

async function runStorageAction(button) {
  const action = button.dataset.storageAction;
  if (action === 'manage-apps') {
    appManagerState.intent = 'clear';
    setAppManagerView('apps');
    await loadAppManager();
    $('appManagerSearch').focus();
    return;
  }
  const config = STORAGE_ACTIONS[action];
  if (!config) return;
  const contextError = validateActionContext(config.actionId);
  if (contextError) {
    lastErrorMessage = contextError;
    setTaskStatus('warning', contextError);
    return;
  }
  if (!appManagerState.storage || appManagerState.storageLoading) await loadStorageSummary();
  const before = appManagerState.storage?.categories?.[config.category];
  if (!before) return;
  const selectedDevice = $('deviceSelect').selectedOptions[0];
  const scannedTarget = `${before.count ?? '未统计'} ${before.unit} · ${formatBytes(before.bytes)} · ${before.paths.join('、')}`;
  const message = `${config.message}\n\n扫描结果：${scannedTarget}`;
  const compactTarget = `${before.count ?? '未统计'} ${before.unit} · ${formatBytes(before.bytes)}`;
  if (!(await askRiskConfirmation({ message, action: config.label, target: compactTarget }))) return;
  if (!beginTask(config.label, config.actionId)) return;
  button.disabled = true;
  $('storageManagerMessage').textContent = `正在执行：${config.label}`;
  const payload = { serial: selectedDevice?.value || '', transport: selectedDevice?.dataset.transport || '' };
  if (DANGEROUS_ACTIONS.has(config.actionId)) payload.riskConfirmed = true;
  appendLog(`\n[存储清理] ${config.label}\n`);
  try {
    const result = await window.gaoji.run(config.actionId, payload);
    if (result.stdout) appendLog(result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`);
    if (result.stderr) appendLog(result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`);
    const failed = Array.isArray(result.data?.failed) ? result.data.failed : [];
    await loadStorageSummary({ allowActiveTask: true });
    const after = appManagerState.storage?.categories?.[config.category];
    const released = Math.max(0, Number(before.bytes) - Number(after?.bytes || 0));
    const processed = Math.max(0, Number(before.count) - Number(after?.count || 0));
    const outcome = `${config.label}完成：已处理 ${processed} ${before.unit}，释放 ${formatBytes(released)}${failed.length ? `；失败 ${failed.length} 项：${failed.slice(0, 2).join('、')}` : '；无失败项'}`;
    appManagerState.storageResult = outcome;
    if (result.code !== 0) {
      appManagerState.storageError = outcome;
      lastErrorMessage = result.stderr || result.stdout || `${config.label}失败。`;
      finishTask('error', outcome, result.code);
    } else {
      finishTask('success', outcome, result.code);
    }
    renderStorageManager();
  } catch (error) {
    appManagerState.storageError = error.message;
    lastErrorMessage = error.message;
    appendLog(`[失败] ${error.message}\n`);
    finishTask('error', `${config.label}执行失败`);
    renderStorageManager();
  } finally {
    button.disabled = false;
  }
}

async function runAppManagerAction(button) {
  const app = appManagerState.apps.find((item) => item.packageName === appManagerState.selectedPackage);
  const action = button.dataset.appAction;
  const actionId = APP_MANAGER_ACTIONS[action];
  if (!app || !actionId) return;
  const contextError = validateActionContext(actionId);
  if (contextError) {
    lastErrorMessage = contextError;
    setTaskStatus('warning', contextError);
    return;
  }
  const selectedDevice = $('deviceSelect').selectedOptions[0];
  const payload = { packageName: app.packageName, serial: selectedDevice?.value || '', transport: selectedDevice?.dataset.transport || '' };
  const label = button.textContent.trim();
  const confirmText = action === 'clear'
    ? `清理“${app.label}”的全部数据后不可恢复，确认继续？`
    : action === 'uninstall'
      ? `仅从当前用户卸载“${app.label}”，确认继续？`
      : '';
  if (confirmText && !(await askRiskConfirmation({ message: confirmText, action: label, target: app.packageName }))) return;
  if (DANGEROUS_ACTIONS.has(actionId)) payload.riskConfirmed = true;
  if (!beginTask(label, actionId)) return;
  button.disabled = true;
  appManagerState.error = '';
  $('appManagerMessage').textContent = `正在执行：${label}`;
  appendLog(`\n[应用管理] ${label} ${app.packageName}\n`);
  try {
    const before = filteredApps();
    const index = before.findIndex((item) => item.packageName === app.packageName);
    const nextPackage = before[index + 1]?.packageName || before[index - 1]?.packageName || '';
    const result = await window.gaoji.run(actionId, payload);
    if (result.stdout) appendLog(result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`);
    if (result.stderr) appendLog(result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`);
    if (result.code !== 0) {
      appManagerState.error = result.stderr || result.stdout || `${label}失败。`;
      lastErrorMessage = appManagerState.error;
      finishTask('error', `${label}未完成`, result.code);
      renderAppManager();
      return;
    }
    finishTask('success', `${label}已完成`, result.code);
    if (['freeze', 'unfreeze', 'uninstall'].includes(action)) {
      await loadAppManager(action === 'uninstall' ? nextPackage : app.packageName, { allowActiveTask: true });
    } else {
      renderAppManager();
      $('appManagerMessage').textContent = result.stdout || `${label}已完成。`;
    }
  } catch (error) {
    appManagerState.error = error.message;
    lastErrorMessage = error.message;
    appendLog(`[失败] ${error.message}\n`);
    finishTask('error', `${label}执行失败`);
    renderAppManager();
  } finally {
    button.disabled = false;
  }
}

async function runAppBatchAction(button) {
  const action = button.dataset.appBatchAction;
  const config = APP_BATCH_ACTIONS[action];
  const apps = eligibleBatchApps(action);
  if (!config || !apps.length) {
    setTaskStatus('warning', '当前选择中没有可执行此操作的应用');
    return;
  }
  const contextError = validateActionContext(config.actionId);
  if (contextError) {
    lastErrorMessage = contextError;
    setTaskStatus('warning', contextError);
    return;
  }
  const selectedDevice = $('deviceSelect').selectedOptions[0];
  const packageNames = apps.map((app) => app.packageName);
  const payload = { packageNames, serial: selectedDevice?.value || '', transport: selectedDevice?.dataset.transport || '' };
  const names = apps.slice(0, 5).map((app) => app.label).join('、');
  const target = `${apps.length} 个应用：${names}${apps.length > 5 ? ` 等 ${apps.length} 个` : ''}`;
  if (config.dangerous) {
    const verb = action === 'uninstall' ? '仅从当前用户卸载' : '冻结';
    const message = `${verb}选中的 ${apps.length} 个应用，操作设备为 ${selectedDevice?.value || '当前设备'}，确认继续？`;
    if (!(await askRiskConfirmation({ message, action: config.label, target }))) return;
  }
  if (DANGEROUS_ACTIONS.has(config.actionId)) payload.riskConfirmed = true;
  if (!beginTask(config.label, config.actionId, apps.length)) return;
  button.disabled = true;
  appManagerState.error = '';
  $('appManagerMessage').textContent = `正在执行：${config.label}（${apps.length} 个应用）`;
  appendLog(`\n[应用批量管理] ${config.label} ${packageNames.join(', ')}\n`);
  try {
    const result = await window.gaoji.run(config.actionId, payload);
    if (result.stdout) appendLog(result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`);
    if (result.stderr) appendLog(result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`);
    const succeeded = Array.isArray(result.data?.succeeded) ? result.data.succeeded : [];
    succeeded.forEach((packageName) => appManagerState.selectedPackages.delete(packageName));
    if (action !== 'export') await loadAppManager(appManagerState.selectedPackage, { allowActiveTask: true });
    if (result.code !== 0) {
      appManagerState.error = result.stderr || result.stdout || `${config.label}存在失败项。`;
      lastErrorMessage = appManagerState.error;
      finishTask('error', `${config.label}完成，但有失败项`, result.code);
    } else {
      finishTask('success', `${config.label}完成：${succeeded.length} 个`, result.code);
    }
    renderAppManager();
    $('appManagerMessage').textContent = result.code === 0 ? (result.stdout || `${config.label}已完成。`) : appManagerState.error;
  } catch (error) {
    appManagerState.error = error.message;
    lastErrorMessage = error.message;
    appendLog(`[失败] ${error.message}\n`);
    finishTask('error', `${config.label}执行失败`);
    renderAppManager();
  } finally {
    button.disabled = false;
  }
}

async function runAction(button) {
  const action = button.dataset.action;
  if (taskState.current?.state === 'running') {
    setTaskStatus('warning', `已有任务正在执行：${taskState.current.label}`);
    return;
  }

  const formPayload = await collectActionPayload(action);
  if (formPayload === null) return;
  // resolveActionPayload 返回 false 表示参数不可用（例如槽位解析被拦下），
  // 此时已完成日志提示，直接中止本次执行而不是带着旧值往下走。
  if (formPayload === false) return;
  const payload = { ...formPayload };
  if (button.dataset.part) payload.part = button.dataset.part;
  // 按钮上的 data-partition 只是给参数弹窗一个默认值（见 ACTION_FORMS 的字段初值）。
  // 弹窗关闭后用户可能改过分区与槽位，因此这里只在弹窗没产出 partition 时才回填，
  // 否则会把已经拼好槽位后缀的 boot_a 覆盖回 boot。
  if (button.dataset.partition && !payload.partition) payload.partition = button.dataset.partition;
  if (button.dataset.dir) payload.dir = button.dataset.dir;
  if (button.dataset.allowErase) payload.allowErase = button.dataset.allowErase === 'true';
  if (button.dataset.url) payload.url = button.dataset.url;
  if (button.dataset.name) payload.name = button.dataset.name;
  if (action.startsWith('firmware-')) payload.xmlMode = firmwareXmlMode;
  const selectedDevice = $('deviceSelect').selectedOptions[0];
  if (selectedDevice?.value) {
    payload.serial = selectedDevice.value;
    payload.transport = selectedDevice.dataset.transport || '';
  }

  const label = button.textContent.trim().replace(/\s+/g, ' ');
  const contextError = validateActionContext(action);
  if (contextError) {
    lastErrorMessage = contextError;
    appendLog(`[阻止] ${label}：${contextError}\n`);
    setTaskStatus('warning', contextError);
    return;
  }
  // 确认弹窗必须显示**最终**写入目标，而不是用户选的类型。
  // 对 A/B 机型来说 payload.partition 已经是 boot_a / boot_b，
  // 用户在这一步能看出槽位是否选对——这是刷机前最后一道防线。
  const confirmText = button.dataset.confirm || ACTION_CONFIRMS[action] || (DANGEROUS_ACTIONS.has(action) ? `${label}可能修改设备或应用状态，确认继续？` : '');
  const confirmTarget = payload.partition || payload.packageName || payload.dir || label;
  if (confirmText && !(await askRiskConfirmation({ message: confirmText, action: label, target: confirmTarget }))) return;
  if (DANGEROUS_ACTIONS.has(action)) payload.riskConfirmed = true;
  if (!beginTask(label, action)) return;
  const showsInstallProgress = INSTALL_ACTIONS.has(action);
  appendLog(`\n[执行] ${label}\n`);
  button.disabled = true;
  if (showsInstallProgress) showInstallProgress(label);

  try {
    const result = await window.gaoji.run(action, payload);
    if (result.navigate) switchPage(result.navigate);
    if (result.firmwarePath && $('firmwareSelection')) {
      const selection = $('firmwareSelection');
      if ('value' in selection) selection.value = result.firmwarePath;
      else selection.textContent = result.firmwarePath;
    }
    if (result.preview && $('firmwarePreview')) $('firmwarePreview').textContent = result.preview;
    if (result.stdout) appendLog(result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`);
    if (result.stderr) appendLog(result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`);
    appendLog(`[完成] 退出码：${result.code}\n`);
    if (result.code === 0) {
      finishTask('success', `${label}已完成`, result.code);
      if (showsInstallProgress) finishInstallProgress(true);
    } else {
      lastErrorMessage = result.stderr || result.stdout || `${label}未完成`;
      finishTask(result.code === 409 ? 'warning' : 'error', `${label}未完成，请查看日志`, result.code);
      if (showsInstallProgress) finishInstallProgress(false, result.stderr || result.stdout);
    }
    await refreshStatus();
  } catch (error) {
    lastErrorMessage = error.message;
    appendLog(`[失败] ${error.message}\n`);
    finishTask('error', `${label}执行失败`);
    if (showsInstallProgress) finishInstallProgress(false, error.message);
  } finally {
    button.disabled = false;
    updateRebootAvailability();
  }
}

function showInstallProgress(label) {
  window.clearTimeout(installProgressTimer);
  installProgressTimer = null;
  const dialog = $('installProgressDialog');
  dialog.dataset.state = 'installing';
  $('installProgressTitle').textContent = '正在安装';
  $('installProgressMessage').textContent = `${label}，请保持设备连接...`;
  $('installProgressIcon').innerHTML = '<i class="ph ph-download-simple" aria-hidden="true"></i>';
  $('installProgressTrack').hidden = false;
  $('closeInstallProgress').hidden = true;
  if (!dialog.open) dialog.showModal();
}

function finishInstallProgress(success, detail = '') {
  const dialog = $('installProgressDialog');
  dialog.dataset.state = success ? 'success' : 'error';
  $('installProgressIcon').innerHTML = `<i class="ph ${success ? 'ph-check' : 'ph-warning'}" aria-hidden="true"></i>`;
  $('installProgressTitle').textContent = success ? '成功安装' : '安装失败';
  $('installProgressMessage').textContent = success ? '应用已成功安装，3 秒后自动关闭。' : (detail || '安装未完成，请查看运行日志。');
  $('installProgressTrack').hidden = true;
  $('closeInstallProgress').hidden = success;
  if (success) {
    installProgressTimer = window.setTimeout(() => {
      if (dialog.open) dialog.close();
      installProgressTimer = null;
    }, 3000);
  }
}

function collectActionPayload(action) {
  const config = ACTION_FORMS[action];
  if (!config) return Promise.resolve({});
  const dialog = $('actionDialog');
  const form = $('actionDialogForm');
  const fields = $('actionDialogFields');
  $('actionDialogTitle').textContent = config.title;
  $('actionDialogDescription').textContent = config.description;
  fields.replaceChildren();

  for (const field of config.fields) {
    const label = document.createElement('label');
    label.className = 'action-field';
    const caption = document.createElement('span');
    caption.textContent = field.label;
    let control;
    if (field.type === 'select') {
      control = document.createElement('select');
      for (const [value, text] of field.options) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        option.selected = value === field.value;
        control.appendChild(option);
      }
    } else {
      control = document.createElement('input');
      control.type = 'text';
      control.value = field.value || '';
      if (field.pattern) control.pattern = field.pattern;
      control.required = field.required !== false;
    }
    control.name = field.name;
    label.append(caption, control);
    if (field.hint) {
      const hint = document.createElement('small');
      hint.textContent = field.hint;
      label.appendChild(hint);
    }
    // 记录字段与所属分区下拉的绑定，供下方联动使用
    if (field.name === 'customPartition' || field.name === 'slot') {
      label.dataset.field = field.name;
      label.dataset.dependsOn = 'partition';
    }
    fields.appendChild(label);
  }

  // 分区选"自定义"时才显示自定义输入框；其它分区不需要它。
  // 这样界面上不会同时出现互相矛盾的选项。
  const syncFieldVisibility = () => {
    const partitionControl = fields.querySelector('[name="partition"]');
    const customLabel = fields.querySelector('label[data-field="customPartition"]');
    const slotLabel = fields.querySelector('label[data-field="slot"]');
    const customInput = customLabel?.querySelector('input');
    const isCustom = partitionControl?.value === 'custom';
    if (customLabel) {
      customLabel.hidden = !isCustom;
      if (customInput) customInput.required = isCustom;
    }
    if (slotLabel) slotLabel.hidden = false;
  };
  const partitionControl = fields.querySelector('[name="partition"]');
  if (partitionControl) {
    partitionControl.addEventListener('change', syncFieldVisibility);
    syncFieldVisibility();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form).entries());
      dialog.close();
      finish(resolveActionPayload(action, values));
    };
    dialog.onclose = () => finish(null);
    dialog.showModal();
    fields.querySelector('input, select')?.focus();
  });
}

/**
 * 表单值 → 后端 payload 的收尾处理。
 *
 * 目前只有 flash-image 需要加工：把「分区类型 + 槽位」拼成真实分区名。
 * 拼装规则复用 slot_resolver.js——与主进程同一份实现，
 * 避免出现"界面显示 boot_a、实际写入 boot_b"这类两侧不一致。
 */
function resolveActionPayload(action, values) {
  const payload = { ...values };
  if (action !== 'flash-image') return payload;

  const resolver = window.SLOT_RESOLVER;
  const base = payload.partition === 'custom'
    ? String(payload.customPartition || '').trim()
    : String(payload.partition || 'boot');
  delete payload.customPartition;

  // resolver 缺失属于加载顺序错误，宁可让它显式失败也不静默拼错分区
  if (!resolver) {
    payload.partition = base;
    appendLog('[槽位] 分区解析模块未加载，已按原始分区名提交，请人工核对。\n');
    return payload;
  }

  const device = {
    isAbDevice: Boolean(latestDeviceSlot),
    currentSlot: latestDeviceSlot
  };
  const target = resolver.resolveFlashTarget({ partition: base, slot: payload.slot, device });
  if (target.blocked) {
    // 用 false 表示"取消本次提交"，由调用方按取消处理
    appendLog(`[槽位] ${target.blocked}\n`);
    return false;
  }
  if (target.notes.length) appendLog(`[槽位] ${target.notes.join(' ')}\n`);
  payload.partition = target.partition;
  payload.slot = '';
  return payload;
}

function renderFirmwareLibrary() {
  const query = $('firmwareSearch').value.trim().toLowerCase();
  const brand = $('firmwareBrand').value;
  const items = (window.FIRMWARE_CATALOG || []).filter((item) => {
    const matchesBrand = brand === 'all' || item.brand === brand;
    const haystack = `${item.brand} ${item.name} ${item.model} ${item.code} ${item.region}`.toLowerCase();
    return matchesBrand && (!query || haystack.includes(query));
  });
  $('firmwareResultCount').textContent = `${items.length} 个型号`;
  const list = $('firmwareList');
  list.replaceChildren();
  for (const item of items) {
    const row = document.createElement('article');
    row.className = 'firmware-item';
    row.innerHTML = '<span class="firmware-brand"></span><div><strong></strong><small></small></div><button class="secondary-button" data-action="firmware-open-url"><i class="ph ph-arrow-square-out" aria-hidden="true"></i><span>打开下载页</span></button>';
    row.querySelector('.firmware-brand').textContent = item.brand;
    row.querySelector('strong').textContent = item.name;
    row.querySelector('small').textContent = `${item.model} · ${item.code} · ${item.region}`;
    const button = row.querySelector('button');
    button.dataset.url = item.url;
    button.dataset.name = item.name;
    list.appendChild(row);
  }
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'firmware-empty';
    empty.textContent = '没有匹配的机型，请尝试型号或设备代号。';
    list.appendChild(empty);
  }
}

function openFirmwareLibrary() {
  renderFirmwareLibrary();
  $('firmwareLibrary').showModal();
  $('firmwareSearch').focus();
}

// 可选的界面风格。每套只是同一组 CSS 变量的不同取值，功能与布局完全一致。
const THEMES = [
  { id: 'graphite', label: '深空石墨', icon: 'ph-moon', legacy: 'dark' },
  { id: 'indigo', label: '午夜靛蓝', icon: 'ph-moon-stars', legacy: 'dark' },
  { id: 'obsidian', label: '曜石霓虹', icon: 'ph-lightning', legacy: 'dark' },
  { id: 'light', label: '清亮浅色', icon: 'ph-sun', legacy: 'light' },
  { id: 'sand', label: '暖云米白', icon: 'ph-coffee', legacy: 'light' },
  { id: 'jade', label: '墨玉青瓷', icon: 'ph-leaf', legacy: 'light' }
];

let currentThemeIndex = 0;

function themeById(id) {
  return THEMES.find((theme) => theme.id === id) || THEMES[0];
}

function applyTheme(themeId) {
  const theme = themeById(themeId);
  currentThemeIndex = THEMES.indexOf(theme);
  // 深空石墨沿用原有的 dark 变量块，其余使用各自的主题名。
  document.documentElement.dataset.theme = theme.id === 'graphite' ? 'dark' : theme.id;

  const button = $('themeToggle');
  if (!button) return;
  button.querySelector('i').className = `ph ${theme.icon}`;
  button.title = `界面风格：${theme.label}（点击切换）`;
  button.setAttribute('aria-label', button.title);
  // 供样式表按明暗调整滚动条等原生控件
  document.documentElement.dataset.themeTone = theme.legacy;
}

function cycleTheme() {
  const next = THEMES[(currentThemeIndex + 1) % THEMES.length];
  localStorage.setItem('theme', next.id);
  applyTheme(next.id);
  setTaskStatus('success', `界面风格已切换为「${next.label}」`);
}

async function copyLogToClipboard() {
  await window.gaoji.copyLog(logBuffer);
  setTaskStatus('success', '日志已复制到剪贴板');
}

async function exportCurrentLog() {
  const result = await window.gaoji.exportLog(logBuffer);
  if (result.code === 0) {
    appendLog(`\n[日志] 已导出：${result.filePath}\n`);
    setTaskStatus('success', '日志导出成功');
  } else if (!result.canceled) {
    lastErrorMessage = result.stderr || '日志导出失败';
    setTaskStatus('error', lastErrorMessage);
  }
}

function initializeTheme() {
  const saved = localStorage.getItem('theme');
  // 兼容旧版本保存的 light / dark，映射到新的主题 id。
  const migrated = saved === 'dark' ? 'graphite' : saved === 'light' ? 'light' : saved;
  if (migrated && THEMES.some((theme) => theme.id === migrated)) {
    applyTheme(migrated);
    return;
  }
  applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'graphite' : 'light');
}

document.addEventListener('click', (event) => {
  const nav = event.target.closest('.nav-item');
  if (nav) {
    switchPage(nav.dataset.page);
    return;
  }
  const navigate = event.target.closest('[data-navigate]');
  if (navigate) {
    switchPage(navigate.dataset.navigate);
    return;
  }
  const firmwareMode = event.target.closest('[data-firmware-xml-mode]');
  if (firmwareMode) {
    firmwareXmlMode = firmwareMode.dataset.firmwareXmlMode;
    document.querySelectorAll('[data-firmware-xml-mode]').forEach((tab) => tab.classList.toggle('active', tab === firmwareMode));
    return;
  }
  const libraryButton = event.target.closest('[data-action="firmware-downloads"]');
  if (libraryButton) {
    openFirmwareLibrary();
    return;
  }
  const appManagerButton = event.target.closest('[data-action]');
  const appManagerEntry = appManagerButton ? APP_MANAGER_ENTRIES[appManagerButton.dataset.action] : null;
  if (appManagerEntry) {
    openAppManager(appManagerEntry.view, appManagerEntry.intent);
    return;
  }
  const appManagerView = event.target.closest('[data-app-manager-view]');
  if (appManagerView) {
    setAppManagerView(appManagerView.dataset.appManagerView);
    if (appManagerState.view === 'storage') loadStorageSummary();
    else if (!appManagerState.apps.length) loadAppManager();
    return;
  }
  const storageAction = event.target.closest('[data-storage-action]');
  if (storageAction) {
    runStorageAction(storageAction);
    return;
  }
  const storageFileCategory = event.target.closest('[data-storage-file-category]');
  if (storageFileCategory) {
    loadStorageFiles(storageFileCategory.dataset.storageFileCategory);
    return;
  }
  const storageFileSelect = event.target.closest('[data-storage-file-select]');
  if (storageFileSelect) {
    if (storageFileSelect.checked) appManagerState.selectedStorageFiles.add(storageFileSelect.dataset.storageFileSelect);
    else appManagerState.selectedStorageFiles.delete(storageFileSelect.dataset.storageFileSelect);
    renderStorageFiles();
    return;
  }
  const storageFileAction = event.target.closest('[data-storage-file-action]');
  if (storageFileAction) {
    if (storageFileAction.dataset.storageFileAction === 'export') exportSelectedStorageFiles();
    else if (storageFileAction.dataset.storageFileAction === 'preview-delete') previewSelectedStorageFileDelete();
    return;
  }
  const appAction = event.target.closest('[data-app-action]');
  if (appAction) {
    runAppManagerAction(appAction);
    return;
  }
  const appBatchAction = event.target.closest('[data-app-batch-action]');
  if (appBatchAction) {
    runAppBatchAction(appBatchAction);
    return;
  }
  const appSelect = event.target.closest('[data-app-select]');
  if (appSelect) {
    if (appSelect.checked) appManagerState.selectedPackages.add(appSelect.dataset.appSelect);
    else appManagerState.selectedPackages.delete(appSelect.dataset.appSelect);
    renderAppManager();
    return;
  }
  const appOpen = event.target.closest('[data-app-open]');
  if (appOpen) {
    appManagerState.selectedPackage = appOpen.dataset.appOpen;
    renderAppManager();
    return;
  }
  const appFilter = event.target.closest('[data-app-filter]');
  if (appFilter) {
    appManagerState.filter = appFilter.dataset.appFilter;
    renderAppManager();
    return;
  }
  const button = event.target.closest('[data-action]');
  if (button) runAction(button);
});

$('clearLog').addEventListener('click', () => {
  logBuffer = '';
  renderLog();
  setTaskStatus('success', '日志已清空');
});

$('logSearch').addEventListener('input', renderLog);
$('copyLog').addEventListener('click', copyLogToClipboard);
$('exportLog').addEventListener('click', exportCurrentLog);
$('copyTaskError').addEventListener('click', async () => {
  await window.gaoji.copyLog(lastErrorMessage);
  setTaskStatus('success', '错误信息已复制');
});
$('openTaskCenter').addEventListener('click', () => {
  renderTaskCenter();
  $('taskCenterDialog').showModal();
});
$('closeTaskCenter').addEventListener('click', () => $('taskCenterDialog').close());
$('clearTaskHistory').addEventListener('click', () => {
  taskState.history = [];
  renderTaskCenter();
});
$('closeRiskConfirm').addEventListener('click', () => settleRiskConfirmation(false));
$('cancelRiskConfirm').addEventListener('click', () => settleRiskConfirmation(false));
$('acceptRiskConfirm').addEventListener('click', () => settleRiskConfirmation(true));
$('riskConfirmDialog').addEventListener('cancel', (event) => {
  event.preventDefault();
  settleRiskConfirmation(false);
});

$('refresh').addEventListener('click', () => refreshStatus({ announce: true }));
$('connectionRefresh').addEventListener('click', () => refreshStatus({ announce: true }));
$('fastbootRefresh').addEventListener('click', () => refreshStatus({ announce: true }));
$('themeToggle').addEventListener('click', () => {
  cycleTheme();
});
$('closeFirmwareLibrary').addEventListener('click', () => $('firmwareLibrary').close());
$('closeAppManager').addEventListener('click', () => $('appManagerDialog').close());
$('refreshAppManager').addEventListener('click', () => appManagerState.view === 'storage' ? loadStorageSummary() : loadAppManager());
$('appManagerList').addEventListener('scroll', (event) => {
  appManagerState.listScrollTop = event.currentTarget.scrollTop;
}, { passive: true });
$('appManagerSearch').addEventListener('input', (event) => {
  appManagerState.query = event.target.value;
  renderAppManager();
});
$('appManagerSort').addEventListener('change', (event) => {
  appManagerState.sort = event.target.value;
  renderAppManager();
});
$('storageFileSort').addEventListener('change', (event) => {
  appManagerState.storageFileSort = event.target.value;
  renderStorageFiles();
});
$('selectAllStorageFiles').addEventListener('change', (event) => {
  for (const file of sortedStorageFiles()) {
    if (event.target.checked) appManagerState.selectedStorageFiles.add(file.path);
    else appManagerState.selectedStorageFiles.delete(file.path);
  }
  renderStorageFiles();
});
$('selectAllVisibleApps').addEventListener('change', (event) => {
  for (const app of filteredApps()) {
    if (event.target.checked) appManagerState.selectedPackages.add(app.packageName);
    else appManagerState.selectedPackages.delete(app.packageName);
  }
  renderAppManager();
});
$('closeActionDialog').addEventListener('click', () => $('actionDialog').close());
$('cancelActionDialog').addEventListener('click', () => $('actionDialog').close());
$('closeInstallProgress').addEventListener('click', () => $('installProgressDialog').close());
$('installProgressDialog').addEventListener('cancel', (event) => {
  if ($('installProgressDialog').dataset.state === 'installing') event.preventDefault();
});
$('firmwareSearch').addEventListener('input', renderFirmwareLibrary);
$('firmwareBrand').addEventListener('change', renderFirmwareLibrary);

initializeTheme();
initializeFeaturePages();
appendLog('ADB搞机助手已启动。所有操作都会调用内置 adb/fastboot，并保留真实日志。\n');
refreshStatus();
refreshTimer = window.setInterval(refreshStatus, 7000);
window.addEventListener('beforeunload', () => window.clearInterval(refreshTimer));
