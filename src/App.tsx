import { Layout } from "@/src/components/layout";
import { AuthProvider } from "@/src/lib/auth";
import { useRoute } from "@/src/lib/router";
import HomePage from "@/src/pages/home";
import ResourcesPage from "@/src/pages/resources";
import UniversitiesPage from "@/src/pages/universities";
import AssessmentPage from "@/src/pages/assessment";
import ProfilePage from "@/src/pages/profile";
import LoginPage from "@/src/pages/login";

export default function App() {
  const route = useRoute();
  const path = route.split("?")[0];

  let page;
  switch (path) {
    case "/resources":
      page = <ResourcesPage />;
      break;
    case "/universities":
      page = <UniversitiesPage />;
      break;
    case "/assessment":
      page = <AssessmentPage />;
      break;
    case "/profile":
      page = <ProfilePage />;
      break;
    case "/login":
      page = <LoginPage />;
      break;
    default:
      page = <HomePage />;
  }

  return (
    <AuthProvider>
      <Layout>{page}</Layout>
    </AuthProvider>
  );
}