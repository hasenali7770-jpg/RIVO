allprojects {
    repositories {
        google()
        mavenCentral()

        // The Mapbox Android SDK is not on Maven Central. It is served from
        // Mapbox's own repository, which requires a secret token carrying the
        // `Downloads:Read` scope — a build-time credential, distinct from the
        // public token the app uses at runtime to render the map.
        //
        // Put it in ~/.gradle/gradle.properties (never this repository):
        //   MAPBOX_DOWNLOADS_TOKEN=sk.…
        // or export MAPBOX_DOWNLOADS_TOKEN in the environment. CI reads it from
        // a secret of the same name.
        maven {
            url = uri("https://api.mapbox.com/downloads/v2/releases/maven")
            authentication { create<BasicAuthentication>("basic") }
            credentials {
                // Always the literal "mapbox", never a personal username.
                username = "mapbox"
                password =
                    providers.gradleProperty("MAPBOX_DOWNLOADS_TOKEN").orNull
                        ?: System.getenv("MAPBOX_DOWNLOADS_TOKEN")
                        ?: ""
            }
        }
    }
}

// Without the token Gradle fails with a bare 401 from api.mapbox.com, which
// reads like a network fault rather than a missing credential. Say so plainly.
gradle.projectsEvaluated {
    val token =
        providers.gradleProperty("MAPBOX_DOWNLOADS_TOKEN").orNull
            ?: System.getenv("MAPBOX_DOWNLOADS_TOKEN")
    if (token.isNullOrBlank()) {
        logger.warn(
            "\n[RIVO] MAPBOX_DOWNLOADS_TOKEN is not set. The Mapbox Android SDK cannot be " +
                "downloaded and this build will fail with HTTP 401 from api.mapbox.com.\n" +
                "        Create a secret token with the Downloads:Read scope at " +
                "https://account.mapbox.com/access-tokens/ and add it to " +
                "~/.gradle/gradle.properties as MAPBOX_DOWNLOADS_TOKEN=sk...\n",
        )
    } else if (!token.startsWith("sk.")) {
        logger.warn(
            "\n[RIVO] MAPBOX_DOWNLOADS_TOKEN does not look like a secret token (it should start " +
                "with \"sk.\"). A public token (pk...) has no Downloads:Read scope and this " +
                "build will fail with HTTP 401.\n",
        )
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
