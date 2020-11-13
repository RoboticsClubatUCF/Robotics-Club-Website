<?php

// header functions and include
include_once("../../assets/templates/header.php");
$pageDescription = "Demobot is a robot that shows off all aspects of robotics to the general public to incite interest and learning in robotics.";
$keywords = "UCF robotics club, University of Central Florida, UCF, robotics club, robotics club,
                               UCF robotics, UCF club, RSO, AUVSI, autonomous, SUAS, AHRS, IMU, i2C, ROS, ROS melodic,
                               melodic, linux, ubuntu, open source, opensource, engineering, mechanical,
                               mechanical engineering, electrical, eletrical engineering, computer, computers,
                               computer science, FOSS, undergraduate, graduate, operating system, vehicles, unmanned,
                               machine learning, computer vision, sensors, lidar, demobot, citrobot, Robotics Club of
                               Central Florida, central florida, robotics club, demobot, demonstration robot, demonstration, demonstrative,
                               demonstrative robot, spider bot, robot, spider";
$headerGen = new Header("Alexandra French", "August 5, 2020", "Alexandra French", "November 12, 2020");
$headerGen->generateComment();
$headerGen->generateCommon("Robotics Club Project: Demobot", $pageDescription, $keywords, "https://robotics.ucf.edu/projects/demobot/index");
$headerGen->generateCSS();
$headerGen->genProjectSEO("https://robotics.ucf.edu/projects/demobot/index", "Robotics Club Project: Demobot", $pageDescription, "August 2019", "https://robotics.ucf.edu/projects/assets/imgs/demobot.jpg");
$headerGen->endHeader();


// navbar
include_once("../../assets/templates/navbar.php");
$navbarGen = new Navbar(False);


// page content
include_once('assets/templates/demobot.html');

?>

    <!-- Team members-->
    <?php
      // members list addition
      $csvFile = "assets/misc/membersListDemobot.csv";
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
