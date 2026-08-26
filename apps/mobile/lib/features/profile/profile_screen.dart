import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers/providers.dart';
import '../../core/theme/rivo_colors.dart';
import '../../core/theme/rivo_theme.dart';
import '../../shared/widgets/rivo_widgets.dart';

/// User profile — Master Plan §8.
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AuthState auth = ref.watch(authProvider);

    if (auth is! Authenticated) {
      return Scaffold(
        body: RivoEmptyView(
          icon: Icons.person_outline_rounded,
          title: 'سجّل الدخول',
          hint: 'لإضافة عقار، حفظ الإعلانات، والإبلاغ عن حالة الطرق.',
          action: ElevatedButton(
            onPressed: () => context.push('/auth/phone?next=%2Fprofile'),
            child: const Text('تسجيل الدخول'),
          ),
        ),
      );
    }

    final RivoUser user = auth.user;

    return Scaffold(
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 24, 20, 120),
        children: <Widget>[
          Row(
            children: <Widget>[
              CircleAvatar(
                radius: 30,
                backgroundColor: RivoColors.surfaceLighter,
                child: Text(
                  (user.displayName?.isNotEmpty ?? false)
                      ? user.displayName!.characters.first
                      : '؟',
                  style: const TextStyle(fontSize: 24, color: RivoColors.sand),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      user.displayName ?? 'مستخدم ريفو',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      user.phone,
                      textDirection: TextDirection.ltr,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    if (user.isVerifiedSeller) ...<Widget>[
                      const SizedBox(height: 6),
                      const VerifiedChip(),
                    ],
                  ],
                ),
              ),
            ],
          ),

          const SizedBox(height: 28),

          _Section(
            title: 'داركم',
            items: <_Item>[
              _Item(
                icon: Icons.add_home_work_rounded,
                label: 'أضف عقاراً',
                onTap: () => context.push('/listing/new'),
              ),
              _Item(
                icon: Icons.list_alt_rounded,
                label: 'إعلاناتي',
                onTap: () => context.push('/my-listings'),
              ),
              _Item(
                icon: Icons.favorite_rounded,
                label: 'العقارات المحفوظة',
                onTap: () => context.push('/my-listings?tab=favorites'),
              ),
            ],
          ),

          _Section(
            title: 'الحساب',
            items: <_Item>[
              _Item(
                icon: Icons.privacy_tip_rounded,
                label: 'الخصوصية وبيانات الحركة',
                onTap: () => context.push('/privacy'),
              ),
              _Item(
                icon: Icons.verified_user_rounded,
                label: 'توثيق الحساب',
                subtitle: user.isVerifiedSeller ? 'حسابك موثّق' : 'غير موثّق',
                onTap: () => ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('لطلب التوثيق، تواصل مع فريق ريفو عبر صفحة الدعم.'),
                  ),
                ),
              ),
            ],
          ),

          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: () async {
              final bool? confirmed = await showDialog<bool>(
                context: context,
                builder: (BuildContext context) => AlertDialog(
                  title: const Text('تسجيل الخروج'),
                  content: const Text('هل تريد تسجيل الخروج من هذا الجهاز؟'),
                  actions: <Widget>[
                    TextButton(
                      onPressed: () => Navigator.pop(context, false),
                      child: const Text('إلغاء'),
                    ),
                    TextButton(
                      onPressed: () => Navigator.pop(context, true),
                      child: const Text('خروج'),
                    ),
                  ],
                ),
              );
              if (confirmed == true) {
                await ref.read(authProvider.notifier).signOut();
                if (context.mounted) context.go('/maps');
              }
            },
            icon: const Icon(Icons.logout_rounded, size: 18),
            label: const Text('تسجيل الخروج'),
          ),

          const SizedBox(height: 28),
          Center(
            child: Column(
              children: <Widget>[
                Text('RIVO', style: Theme.of(context).textTheme.titleMedium),
                Text('خرائط | داركم', style: Theme.of(context).textTheme.labelSmall),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.items});
  final String title;
  final List<_Item> items;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Text(title, style: Theme.of(context).textTheme.labelMedium),
          ),
          Container(
            decoration: BoxDecoration(
              color: RivoColors.surface,
              borderRadius: BorderRadius.circular(RivoTheme.radiusSm),
            ),
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: <Widget>[
                for (int i = 0; i < items.length; i += 1) ...<Widget>[
                  ListTile(
                    leading: Icon(items[i].icon, color: RivoColors.sand, size: 21),
                    title: Text(items[i].label),
                    subtitle: items[i].subtitle == null ? null : Text(items[i].subtitle!),
                    trailing: const Icon(Icons.chevron_left_rounded, size: 20),
                    onTap: items[i].onTap,
                  ),
                  if (i < items.length - 1) const Divider(height: 1, indent: 56),
                ],
              ],
            ),
          ),
          const SizedBox(height: 24),
        ],
      );
}

class _Item {
  const _Item({required this.icon, required this.label, required this.onTap, this.subtitle});
  final IconData icon;
  final String label;
  final String? subtitle;
  final VoidCallback onTap;
}
