    <div class="intermediate-container-xs">
      <h2 class="rounded p-1 text-center<?php
        if ($membersTitleColor == "gold") {
          echo " title-blk-gold";
        } else {
          echo " title-blk-wht";
        }
      ?>"><?php echo $membersTitle ?></h2>
      <div class="row align-items-center justify-content-center">
        <?php
          $membersList = array();
          // open up a csv file containing a list of members of form lastname, firstname
          // if failure, ignore
          if (($membersListCsv = fopen($csvFile, "r")) != FALSE)
          {
            $currMember = 0;
            echo("<!-- all members -->\n\t\t");
            // print each member
            while (($member = fgetcsv($membersListCsv, 1000, ",")) != FALSE) {
              echo("<div class=\"col-lg-3 col-sm-4 mb-4 text-center rounded ");
              // iff even, gold, else white
              if ($currMember%2 == 0) {
                echo("members-gold");
              } else {
                echo("members-wht");
              }
              echo "\"><p>" . $member[0] . ", " . $member[1] . "</p></div>&nbsp;\n\t\t";
               $currMember += 1;
            }
            echo("<!-- /.all members -->\n");
            fclose($membersListCsv);
          }
        ?>
      </div>
    </div>
