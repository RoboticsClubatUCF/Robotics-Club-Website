<?php

// header functions and include
include_once("../assets/templates/header.php");
$pageDescription = "The Robotics Club of Central Florida has kept an archive of all past members from the 2010s.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, past members, 2010s, 2010s members, 2010";
$headerGen = new Header("Alexandra French", "August 25, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("Past Robotics Club Members (2010s)", $pageDescription, $keywords, "https://robotics.ucf.edu/about/past-members-2010s");
$headerGen->generateCSS();
$headerGen->genWebsiteSEO("https://robotics.ucf.edu/about/past-members-2010s", "Past Robotics Club Members (2010s)", $pageDescription);
$headerGen->endHeader();


// navbar
include_once("../assets/templates/navbar.php");
$navbarGen = new Navbar(False);

?>

<!-- Page Content -->
<div class="container">

  <!-- past members -->
  <div class="header-container-sm">
    <h1 class="mt-4 mb-3 text-center rounded p-1 title-blk-gold">Past Members
    </h1>

    <!-- text content -->
    <div class="row align-items-center justify-content-center text-center">
      <div class="col-lg-12">
        <div class="container-wht-blk rounded p-3">
          <p>The Robotics Club of Cental Florida has been a long running club. This page exists
            to help capture the history of our members. We can date ourselves all the way back to 2016.
          </p>
        </div>
      </div>
    </div>
  </div>
  <!-- /.past members -->

  <!-- tabs for year segments -->
  <ul class="nav nav-tabs wht-tabs">
   <li class="nav-item rounded-top">
     <a class="nav-link" href="past-members">2020s</a>
   </li>
   <li class="nav-item rounded-top">
     <a class="nav-link active" href="past-members-2010s">2010s</a>
   </li>
  </ul>
  <!-- /.tabs for year segments -->

  <?php
    // all memebr year and semester tabs
    $memberYears = array(
      "2019" => array("Fall", "Spring"),
      "2018" => array("Fall", "Spring"),
      "2017" => array("Year Round"),
      "2016" => array("Year Round"));
    include_once("assets/templates/members-by-semester.php");
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
