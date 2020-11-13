<?php

// header functions and include
include_once("../../assets/templates/header.php");
$pageDescription = "Bowser is our smart, self-controlled, and fast autonomous ground robot.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, autonomous ground vehicle, Bowser, IGVC";
$headerGen = new Header("Alexandra French", "August 5, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("Robotics Club Project: Bowser", $pageDescription, $keywords, "https://robotics.ucf.edu/4projects/bowser/index");
$headerGen->generateCSS();
$headerGen->genProjectSEO("https://robotics.ucf.edu/projects/bowser/index", "Robotics Club Project: Bowser", $pageDescription, "August 2018", "https://robotics.ucf.edu/projects/assets/imgs/bowser.jpg");
$headerGen->endHeader();


// navbar
include_once("../../assets/templates/navbar.php");
$navbarGen = new Navbar(False);

// page content
include_once('assets/templates/bowser.html');

?>
    <!-- Team members-->
    <?php
      // members list addition
      $csvFile = "assets/misc/membersListBowser.csv";
      $membersTitle = "Team Members";
      $membersTitleColor = "gold";
      include_once('../../assets/templates/members-list.php');
    ?>
    <!-- /.Team members -->

  </div>
  <!-- /.container -->

<?php

// footer functions and include
include_once("../../assets/templates/footer.php");
$footerGen = new Footer();
$footerGen->generateFooter();
$footerGen->generateJs();
$footerGen->endFile();

?>
