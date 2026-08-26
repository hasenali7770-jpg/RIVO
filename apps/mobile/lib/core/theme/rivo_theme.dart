import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'rivo_colors.dart';

/// RIVO's own design language — Master Plan §1 forbids copying Waze, Google
/// Maps, Property Finder, TikTok or Instagram.
///
/// The identity here is: a deep petroleum ground, generous corner radii, sand
/// for anything to do with money, and red reserved for the fastest route and
/// primary actions so it keeps its meaning.
class RivoTheme {
  const RivoTheme._();

  static const String fontFamily = 'Cairo';

  /// Corner radii. Larger than Material's default, which is what makes the
  /// surfaces read as RIVO rather than as stock Android.
  static const double radiusSm = 10;
  static const double radiusMd = 16;
  static const double radiusLg = 22;
  static const double radiusPill = 999;

  static ThemeData dark() {
    const scheme = ColorScheme.dark(
      primary: RivoColors.signalRed,
      onPrimary: Colors.white,
      secondary: RivoColors.sand,
      onSecondary: RivoColors.petrol,
      tertiary: RivoColors.success,
      surface: RivoColors.surface,
      onSurface: RivoColors.white,
      error: RivoColors.signalRed,
      onError: Colors.white,
    );

    return _base(scheme, RivoColors.petrol).copyWith(
      appBarTheme: const AppBarTheme(
        backgroundColor: RivoColors.petrol,
        foregroundColor: RivoColors.white,
        elevation: 0,
        centerTitle: false,
        systemOverlayStyle: SystemUiOverlayStyle.light,
        titleTextStyle: TextStyle(
          fontFamily: fontFamily,
          fontSize: 20,
          fontWeight: FontWeight.w600,
          color: RivoColors.white,
        ),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: RivoColors.surface,
        selectedItemColor: RivoColors.signalRed,
        unselectedItemColor: Color(0x99F7F7F4),
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
    );
  }

  static ThemeData light() {
    const scheme = ColorScheme.light(
      primary: RivoColors.signalRed,
      onPrimary: Colors.white,
      secondary: RivoColors.sandDim,
      onSecondary: RivoColors.petrol,
      tertiary: RivoColors.success,
      surface: Colors.white,
      onSurface: RivoColors.petrol,
      error: RivoColors.signalRed,
      onError: Colors.white,
    );

    return _base(scheme, RivoColors.white).copyWith(
      appBarTheme: const AppBarTheme(
        backgroundColor: RivoColors.white,
        foregroundColor: RivoColors.petrol,
        elevation: 0,
        centerTitle: false,
        systemOverlayStyle: SystemUiOverlayStyle.dark,
        titleTextStyle: TextStyle(
          fontFamily: fontFamily,
          fontSize: 20,
          fontWeight: FontWeight.w600,
          color: RivoColors.petrol,
        ),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: Colors.white,
        selectedItemColor: RivoColors.signalRed,
        unselectedItemColor: Color(0x99071416),
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
    );
  }

  static ThemeData _base(ColorScheme scheme, Color scaffold) {
    final bool isDark = scheme.brightness == Brightness.dark;

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scaffold,
      fontFamily: fontFamily,
      splashFactory: InkSparkle.splashFactory,

      textTheme: _textTheme(scheme.onSurface),

      cardTheme: CardThemeData(
        color: scheme.surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          side: BorderSide(
            color: isDark ? Colors.white.withValues(alpha: 0.06) : Colors.black.withValues(alpha: 0.06),
          ),
        ),
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: scheme.primary,
          foregroundColor: scheme.onPrimary,
          elevation: 0,
          // 52dp: comfortably above the 48dp minimum touch target, and it makes
          // the primary action unmistakable while driving.
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusSm)),
          textStyle: const TextStyle(fontFamily: fontFamily, fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: scheme.onSurface,
          minimumSize: const Size.fromHeight(52),
          side: BorderSide(
            color: isDark ? Colors.white.withValues(alpha: 0.15) : Colors.black.withValues(alpha: 0.15),
          ),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusSm)),
          textStyle: const TextStyle(fontFamily: fontFamily, fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),

      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: scheme.primary,
          textStyle: const TextStyle(fontFamily: fontFamily, fontSize: 15, fontWeight: FontWeight.w600),
        ),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? RivoColors.surface : Colors.black.withValues(alpha: 0.04),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusSm),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusSm),
          borderSide: BorderSide(
            color: isDark ? Colors.white.withValues(alpha: 0.08) : Colors.black.withValues(alpha: 0.08),
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusSm),
          borderSide: const BorderSide(color: RivoColors.signalRed, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusSm),
          borderSide: const BorderSide(color: RivoColors.signalRed),
        ),
        hintStyle: TextStyle(color: scheme.onSurface.withValues(alpha: 0.35), fontFamily: fontFamily),
      ),

      chipTheme: ChipThemeData(
        backgroundColor: isDark ? RivoColors.surfaceLighter : Colors.black.withValues(alpha: 0.05),
        selectedColor: RivoColors.signalRed,
        labelStyle: TextStyle(fontFamily: fontFamily, fontSize: 13, color: scheme.onSurface),
        secondaryLabelStyle: const TextStyle(fontFamily: fontFamily, fontSize: 13, color: Colors.white),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusPill)),
        side: BorderSide.none,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      ),

      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: scheme.surface,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(radiusLg)),
        ),
        showDragHandle: true,
        dragHandleColor: scheme.onSurface.withValues(alpha: 0.2),
      ),

      dialogTheme: DialogThemeData(
        backgroundColor: scheme.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusMd)),
      ),

      snackBarTheme: SnackBarThemeData(
        backgroundColor: isDark ? RivoColors.surfaceLighter : RivoColors.petrol,
        contentTextStyle: const TextStyle(fontFamily: fontFamily, color: RivoColors.white),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(radiusSm)),
      ),

      dividerTheme: DividerThemeData(
        color: isDark ? Colors.white.withValues(alpha: 0.06) : Colors.black.withValues(alpha: 0.08),
        thickness: 1,
        space: 1,
      ),

      progressIndicatorTheme: const ProgressIndicatorThemeData(color: RivoColors.signalRed),
    );
  }

  static TextTheme _textTheme(Color onSurface) {
    TextStyle style(double size, FontWeight weight, {double? height, Color? color}) => TextStyle(
          fontFamily: fontFamily,
          fontSize: size,
          fontWeight: weight,
          height: height,
          color: color ?? onSurface,
        );

    return TextTheme(
      displayLarge: style(32, FontWeight.w700, height: 1.2),
      displayMedium: style(28, FontWeight.w700, height: 1.2),
      headlineLarge: style(24, FontWeight.w600, height: 1.3),
      headlineMedium: style(20, FontWeight.w600, height: 1.3),
      titleLarge: style(18, FontWeight.w600, height: 1.4),
      titleMedium: style(16, FontWeight.w600, height: 1.4),
      bodyLarge: style(16, FontWeight.w400, height: 1.6),
      bodyMedium: style(14, FontWeight.w400, height: 1.6),
      bodySmall: style(12, FontWeight.w400, height: 1.5, color: onSurface.withValues(alpha: 0.6)),
      labelLarge: style(14, FontWeight.w600),
      labelMedium: style(12, FontWeight.w500),
      labelSmall: style(11, FontWeight.w500, color: onSurface.withValues(alpha: 0.6)),
    );
  }
}
