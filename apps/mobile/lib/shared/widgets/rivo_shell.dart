import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/rivo_colors.dart';
import '../../core/theme/rivo_theme.dart';

/// The `خرائط | داركم` switch — Master Plan §4.
///
/// Rendered as a floating segmented control rather than a standard bottom
/// navigation bar: RIVO's two modes are peers a user flips between, not a list
/// of sections, and the map needs to stay visible underneath.
class RivoShell extends StatelessWidget {
  const RivoShell({required this.location, required this.child, super.key});

  final String location;
  final Widget child;

  static const List<_ShellTab> _tabs = <_ShellTab>[
    _ShellTab(route: '/maps', label: 'خرائط', icon: Icons.navigation_rounded),
    _ShellTab(route: '/darcom', label: 'داركم', icon: Icons.home_work_rounded),
    _ShellTab(route: '/reels', label: 'ريلز', icon: Icons.play_circle_fill_rounded),
    _ShellTab(route: '/profile', label: 'حسابي', icon: Icons.person_rounded),
  ];

  @override
  Widget build(BuildContext context) {
    final int index = _tabs.indexWhere((_ShellTab t) => location.startsWith(t.route));
    final int current = index < 0 ? 0 : index;

    // The reels feed is full-bleed video; a bar floating over it would fight the
    // content, so it sits flush there and floats elsewhere.
    final bool overlayMode = location.startsWith('/maps') || location.startsWith('/reels');

    return Scaffold(
      extendBody: true,
      body: child,
      bottomNavigationBar: SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, overlayMode ? 12 : 8),
          child: Container(
            height: 62,
            decoration: BoxDecoration(
              color: RivoColors.surface.withValues(alpha: 0.96),
              borderRadius: BorderRadius.circular(RivoTheme.radiusPill),
              border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
              boxShadow: <BoxShadow>[
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.35),
                  blurRadius: 24,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: Row(
              children: <Widget>[
                for (int i = 0; i < _tabs.length; i += 1)
                  Expanded(
                    child: _ShellTabButton(
                      tab: _tabs[i],
                      selected: i == current,
                      onTap: () {
                        if (i == current) return;
                        context.go(_tabs[i].route);
                      },
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ShellTab {
  const _ShellTab({required this.route, required this.label, required this.icon});
  final String route;
  final String label;
  final IconData icon;
}

class _ShellTabButton extends StatelessWidget {
  const _ShellTabButton({required this.tab, required this.selected, required this.onTap});

  final _ShellTab tab;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color color = selected ? RivoColors.signalRed : RivoColors.white.withValues(alpha: 0.55);

    return Semantics(
      button: true,
      selected: selected,
      label: tab.label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(RivoTheme.radiusPill),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Icon(tab.icon, size: 22, color: color),
            const SizedBox(height: 3),
            Text(
              tab.label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
