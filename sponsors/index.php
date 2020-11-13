<?php

// header functions and include
include_once("../assets/templates/header.php");
$pageDescription = "The Robotics Club of Central Florida is a student run organization with many great sponsors.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, sponsors, texas instruments, arl, ist,
                               institution for simulation and training, united states army research laboratory, TI,
                               SolidCAM, digi-key, fmw fasteners";
$headerGen = new Header("Alexandra French", "August 5, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("Robotics Club Sponsorst", $pageDescription, $keywords, "https://robotics.ucf.edu/sponsors/index");
$headerGen->generateCSS();
$headerGen->genWebsiteSEO("https://robotics.ucf.edu/sponsors/index", "Robotics Club Sponsors", $pageDescription);
$headerGen->endHeader();


// navbar
include_once("../assets/templates/navbar.php");
$navbarGen = new Navbar(False);

?>

<!-- Page Content -->
  <div class="container">

    <!-- thansk to our sponsors -->
    <div class="header-container-sm">
      <!-- title -->
      <h1 class="mt-4 mb-3 text-center rounded p-2 title-blk-gold">Thanks to Our Sponsors!
      </h1>
      <!-- body text -->
      <div class=row>
        <div class="col-lg-12 mb-12 text-center">
          <div class="container-wht-blk rounded p-3">
            <p class="font-weight-bold">Thanks to all of our sponsors, we have been able to complete multiple robotics projects
              over the years, only getting better each time.
              Here you can meet each company who has helped the Robotics Club of Central Florida advance
              to where we are today.</p>
          </div>
        </div>
      </div>
    </div>
    <!-- /.thanks -->
    
<?php

// sponsor sliders
include_once('assets/templates/sponsor-sliders.php');

?>

  </div>
  <!-- /.container -->
  
<?php

// footer functions and include
include_once("../assets/templates/footer.php");
$footerGen = new Footer();
$footerGen->generateFooter();
$footerGen->generateJs();
$footerGen->endFile();

?>
