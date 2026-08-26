import 'package:flutter/material.dart';

/// RIVO brand palette — Master Plan §1.
/// Mirrors `packages/config/src/brand.ts` and the Tailwind theme.
class RivoColors {
  const RivoColors._();

  /// Deep petroleum — app and map background on the dark theme.
  static const Color petrol = Color(0xFF071416);

  /// Raised surface / cards.
  static const Color surface = Color(0xFF102326);
  static const Color surfaceLight = Color(0xFF163034);
  static const Color surfaceLighter = Color(0xFF1D3D42);

  /// Warm sand — prices and premium highlights.
  static const Color sand = Color(0xFFD8C7A6);
  static const Color sandDim = Color(0xFFB5A688);

  /// Signal red — fastest route, primary CTA, critical alerts.
  static const Color signalRed = Color(0xFFEF4B43);
  static const Color signalRedDim = Color(0xFFC93E37);

  /// Muted green — verified badge, success states.
  static const Color success = Color(0xFF6E9D76);

  /// Off-white — primary text on dark, background on light.
  static const Color white = Color(0xFFF7F7F4);

  // --- Semantic roles, aligned with the presentation deck ------------------
  static const Color fastestRoute = signalRed;
  static const Color alternativeRoute = Color(0xFF5B7C80);
  static const Color price = sand;
  static const Color verified = success;
  static const Color forSale = signalRed;
  static const Color forRent = sand;

  /// Traffic congestion classes returned by Mapbox, painted onto the route line.
  static const Color trafficLow = Color(0xFF6E9D76);
  static const Color trafficModerate = Color(0xFFD8C7A6);
  static const Color trafficHeavy = Color(0xFFE08A5A);
  static const Color trafficSevere = Color(0xFFEF4B43);

  static Color congestionColor(String? level) {
    switch (level) {
      case 'low':
        return trafficLow;
      case 'moderate':
        return trafficModerate;
      case 'heavy':
        return trafficHeavy;
      case 'severe':
        return trafficSevere;
      default:
        return alternativeRoute;
    }
  }
}
