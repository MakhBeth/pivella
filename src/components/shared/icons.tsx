import { forwardRef } from 'react';
import { HugeiconsIcon, type HugeiconsIconProps, type IconSvgElement } from '@hugeicons/react';
import {
  Alert02Icon,
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
  BankIcon,
  BookOpen01Icon,
  Building01Icon,
  Calculator01Icon,
  Calendar03Icon,
  CalendarClockIcon,
  Cancel01Icon,
  Clock01Icon,
  Coins01Icon,
  ComputerIcon,
  DashboardSquare01Icon,
  Database01Icon,
  Delete02Icon,
  Download01Icon,
  Edit01Icon,
  Edit02Icon,
  EuroIcon,
  File02Icon,
  FileAddIcon,
  FileZipIcon,
  FloppyDiskIcon,
  FolderOpenIcon,
  FolderSyncIcon,
  GemIcon,
  GithubIcon,
  InformationCircleIcon,
  Layers01Icon,
  Loading03Icon,
  Moon02Icon,
  MoreHorizontalIcon,
  PaintBoardIcon,
  PercentIcon,
  PiggyBankIcon,
  PlusSignIcon,
  RefreshIcon,
  Settings01Icon,
  SparklesIcon,
  Sun01Icon,
  Tick02Icon,
  TradeUpIcon,
  TreePalmIcon,
  Upload01Icon,
  UserCircleIcon,
  UserIcon,
  UserMultipleIcon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons';

export type IconProps = Omit<HugeiconsIconProps, 'icon'>;
export type IconComponent = ReturnType<typeof createIcon>;

function createIcon(icon: IconSvgElement, name: string) {
  const Icon = forwardRef<SVGSVGElement, IconProps>((props, ref) => (
    <HugeiconsIcon ref={ref} icon={icon} {...props} />
  ));
  Icon.displayName = name;
  return Icon;
}

export const AlertCircle = createIcon(AlertCircleIcon, 'AlertCircle');
export const AlertTriangle = createIcon(Alert02Icon, 'AlertTriangle');
export const ArrowUpDown = createIcon(ArrowUpDownIcon, 'ArrowUpDown');
export const BookOpen = createIcon(BookOpen01Icon, 'BookOpen');
export const Building = createIcon(Building01Icon, 'Building');
export const Calculator = createIcon(Calculator01Icon, 'Calculator');
export const Calendar = createIcon(Calendar03Icon, 'Calendar');
export const CalendarClock = createIcon(CalendarClockIcon, 'CalendarClock');
export const Check = createIcon(Tick02Icon, 'Check');
export const ChevronDown = createIcon(ArrowDown01Icon, 'ChevronDown');
export const ChevronLeft = createIcon(ArrowLeft01Icon, 'ChevronLeft');
export const ChevronRight = createIcon(ArrowRight01Icon, 'ChevronRight');
export const ChevronUp = createIcon(ArrowUp01Icon, 'ChevronUp');
export const Clock = createIcon(Clock01Icon, 'Clock');
export const Coins = createIcon(Coins01Icon, 'Coins');
export const Database = createIcon(Database01Icon, 'Database');
export const Download = createIcon(Download01Icon, 'Download');
export const Edit = createIcon(Edit02Icon, 'Edit');
export const Edit2 = createIcon(Edit01Icon, 'Edit2');
export const Euro = createIcon(EuroIcon, 'Euro');
export const FileArchive = createIcon(FileZipIcon, 'FileArchive');
export const FilePlus = createIcon(FileAddIcon, 'FilePlus');
export const FileText = createIcon(File02Icon, 'FileText');
export const FolderOpen = createIcon(FolderOpenIcon, 'FolderOpen');
export const FolderSync = createIcon(FolderSyncIcon, 'FolderSync');
export const Gem = createIcon(GemIcon, 'Gem');
export const Github = createIcon(GithubIcon, 'Github');
export const Info = createIcon(InformationCircleIcon, 'Info');
export const Landmark = createIcon(BankIcon, 'Landmark');
export const Layers = createIcon(Layers01Icon, 'Layers');
export const LayoutDashboard = createIcon(DashboardSquare01Icon, 'LayoutDashboard');
export const Loader = createIcon(Loading03Icon, 'Loader');
export const Loader2 = createIcon(Loading03Icon, 'Loader2');
export const Monitor = createIcon(ComputerIcon, 'Monitor');
export const Moon = createIcon(Moon02Icon, 'Moon');
export const MoreHorizontal = createIcon(MoreHorizontalIcon, 'MoreHorizontal');
export const Palette = createIcon(PaintBoardIcon, 'Palette');
export const Palmtree = createIcon(TreePalmIcon, 'Palmtree');
export const Percent = createIcon(PercentIcon, 'Percent');
export const PiggyBank = createIcon(PiggyBankIcon, 'PiggyBank');
export const Plus = createIcon(PlusSignIcon, 'Plus');
export const RefreshCw = createIcon(RefreshIcon, 'RefreshCw');
export const Save = createIcon(FloppyDiskIcon, 'Save');
export const Settings = createIcon(Settings01Icon, 'Settings');
export const Sparkles = createIcon(SparklesIcon, 'Sparkles');
export const Sun = createIcon(Sun01Icon, 'Sun');
export const Trash2 = createIcon(Delete02Icon, 'Trash2');
export const TrendingUp = createIcon(TradeUpIcon, 'TrendingUp');
export const Upload = createIcon(Upload01Icon, 'Upload');
export const User = createIcon(UserIcon, 'User');
export const UserCircle = createIcon(UserCircleIcon, 'UserCircle');
export const Users = createIcon(UserMultipleIcon, 'Users');
export const Wallet = createIcon(Wallet01Icon, 'Wallet');
export const X = createIcon(Cancel01Icon, 'X');
