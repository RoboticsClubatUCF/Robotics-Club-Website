<?php

// header functions and include
include_once("../assets/templates/header.php");
$pageDescription = "The Robotics Club of Central Florida has kept our history of officers and leaders in the 2020s.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, past members, 2020s, current memebrs, past members 2020s";
$headerGen = new Header("Alexandra French", "August 5, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("Robotics Club Past Officers", $pageDescription, $keywords, "https://robotics.ucf.edu/about/past-officers");
$headerGen->generateCSS();
$headerGen->genWebsiteSEO("https://robotics.ucf.edu/about/past-officers", "Robotics Club Past Officers", $pageDescription);
$headerGen->endHeader();


// navbar
include_once("../assets/templates/navbar.php");
$navbarGen = new Navbar(False);

?>


  <!-- Page Content -->
  <div class="container">

    <!-- past officers -->
    <div class="header-container-sm">
      <h1 class="mt-4 mb-3 text-center rounded p-1 title-blk-gold">Past Officers
      </h1>

      <!-- text content -->
      <div class="row align-items-center justify-content-center text-center">
        <div class="col-lg-12">
          <div class="container-wht-blk rounded p-3">
            <p>The Robotics Club of Cental Florida has been a long running club. This page exists
              to help capture the history of our officers. Here you can find all of our officers, all
              the way back to 2015.
            </p>
          </div>
        </div>
      </div>
    </div>
    <!-- /.past officers -->

    <!-- tabs for year -->
    <ul class="nav nav-tabs wht-tabs">
     <li class="nav-item rounded-top">
       <a class="nav-link active" href="past-officers">2020s</a>
     </li>
     <li class="nav-item rounded-top">
       <a class="nav-link" href="past-officers-2010s">2010s</a>
     </li>
    </ul>
    <!-- tabs for year -->

    <!-- tabs for officers -->
    <ul class="mini-tabs nav nav-tabs rounded-top">
      <li class="nav-item rounded-top">
        <a class="nav-link active" data-toggle="tab" href="#fa2019">Current</a>
      </li>
    </ul>

<?php

// lengthy officer generation
include_once('assets/templates/officers-current.php');

?>

  </div>
  <!-- /.page content -->

<?php

// footer functions and include
include_once("../assets/templates/footer.php");
$footerGen = new Footer();
$footerGen->generateFooter();
$footerGen->generateJs();
$footerGen->endFile();

?>
