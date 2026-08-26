# RIVO release ProGuard/R8 rules.

# Flutter's own embedding is already covered by the Flutter Gradle plugin; these
# rules cover the plugins RIVO adds.

# Mapbox Maps SDK — reflection over its native bindings.
-keep class com.mapbox.** { *; }
-dontwarn com.mapbox.**

# Sentry keeps stack traces readable in release builds.
-keep class io.sentry.** { *; }
-dontwarn io.sentry.**

# Secure storage and its Tink dependency.
-keep class com.it_nomads.fluttersecurestorage.** { *; }
-keep class com.google.crypto.tink.** { *; }
-dontwarn com.google.crypto.tink.**

# ExoPlayer, used by video_player for reel playback.
-keep class androidx.media3.** { *; }
-dontwarn androidx.media3.**

# Kotlin coroutines internals referenced reflectively.
-dontwarn kotlinx.coroutines.**

# Keep line numbers so a Sentry stack trace points at real source lines.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
