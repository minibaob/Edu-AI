import { Layout } from "@/src/components/layout";
import { AuthProvider } from "@/src/lib/auth";
import { useRoute } from "@/src/lib/router";
import HomePage from "@/src/pages/home";
import ResourcesPage from "@/src/pages/resources";
import UniversitiesPage from "@/src/pages/universities";
import SimulationPage from "@/src/pages/simulation";
import ComparePage from "@/src/pages/compare";
import AssessmentPage from "@/src/pages/assessment";
import ProfilePage from "@/src/pages/profile";
import WrongQuestionsPage from "@/src/pages/wrong-questions";
import LoginPage from "@/src/pages/login";
import AdminImportPage from "@/src/pages/admin-import";

export default function App() {
  const route = useRoute();
  const path = route.split("?")[0];

  let page;
  if (path.startsWith("/universities/")) {
    page = <UniversitiesPage code={path.split("/")[2]} />;
  } else {
    switch (path) {
      case "/resources":
        page = <ResourcesPage />;
        break;
      case "/universities":
        page = <UniversitiesPage />;
        break;
      case "/simulation":
        page = <SimulationPage />;
        break;
      case "/compare":
        page = <ComparePage />;
        break;
      case "/assessment":
        page = <AssessmentPage />;
        break;
      case "/profile":
        page = <ProfilePage />;
        break;
      case "/wrong-questions":
        page = <WrongQuestionsPage />;
        break;
      case "/login":
        page = <LoginPage />;
        break;
      case "/admin/import":
        page = <AdminImportPage />;
        break;
      default:
        page = <HomePage />;
    }
  }

  return (
    <AuthProvider>
      <Layout>{page}</Layout>
    </AuthProvider>
  );
}